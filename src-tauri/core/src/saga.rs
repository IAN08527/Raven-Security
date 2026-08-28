use crate::AppState;
use crate::db::postgres as pg;
use crate::model::{
    Extraction, ExtractedEntity, ExtractedEvidence, ExtractedIdentifier, ExtractedRelation,
};
use sha2::{Digest, Sha256};
use std::path::Path;

/// Saga stages (mirrors architecture.md §6.1). Drives the progress bar.
#[derive(Debug, Clone, Copy)]
pub enum Stage {
    Hash,
    Register,
    Upload,
    Anchor,
    Extract,
    Persist,
    Graph,
    Audit,
    Done,
}

impl Stage {
    pub fn name(self) -> &'static str {
        match self {
            Stage::Hash => "hashing",
            Stage::Register => "registering",
            Stage::Upload => "uploading",
            Stage::Anchor => "anchoring",
            Stage::Extract => "extracting",
            Stage::Persist => "persisting",
            Stage::Graph => "graphing",
            Stage::Audit => "auditing",
            Stage::Done => "committed",
        }
    }
    pub fn pct(self) -> u8 {
        match self {
            Stage::Hash => 5,
            Stage::Register => 15,
            Stage::Upload => 35,
            Stage::Anchor => 55,
            Stage::Extract => 65,
            Stage::Persist => 75,
            Stage::Graph => 85,
            Stage::Audit => 95,
            Stage::Done => 100,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Progress {
    pub stage: &'static str,
    pub pct: u8,
    pub note: Option<String>,
}

pub type ProgressCb<'a> = dyn FnMut(Progress) + Send + 'a;

/// Outcome of a completed (or partially completed) saga run.
#[derive(Debug, serde::Serialize)]
pub struct IngestOutcome {
    pub job_id: i64,
    pub file_id: String,
    pub sha256: String,
    pub storage_key: Option<String>,
    pub ledger_tx_id: Option<String>,
    pub ledger_anchored: bool,
    pub entities: usize,
    pub relationships: usize,
    pub neo4j_synced: bool,
}

/// Run the document ingest saga (architecture.md §6.1).
///
/// Steps that touch external services degrade gracefully:
///   * ledger anchor failure  -> `ledger_status='pending'`, continue (§6.1 step 4)
///   * NLP engine unavailable  -> doc-only ingest, continue (Backlog #3 fills this)
///   * Neo4j merge failure      -> `sync_state='pending'`, continue (D4)
///
/// Only hard failures (hash, case resolution, DB insert, blob upload) abort.
pub async fn run_ingest_saga(
    state: &AppState,
    path: &str,
    case_id: &str,
    source: &str,
    on_progress: &mut ProgressCb<'_>,
) -> Result<IngestOutcome, String> {
    let mut report = IngestOutcome {
        job_id: 0,
        file_id: String::new(),
        sha256: String::new(),
        storage_key: None,
        ledger_tx_id: None,
        ledger_anchored: false,
        entities: 0,
        relationships: 0,
        neo4j_synced: false,
    };

    let prog = |cb: &mut ProgressCb<'_>, stage: Stage, note: Option<String>| {
        cb(Progress {
            stage: stage.name(),
            pct: stage.pct(),
            note,
        });
    };

    // --- Step 1: stream + SHA-256 + magic-byte MIME -------------------------
    let bytes = std::fs::read(path).map_err(|e| format!("read file '{}': {}", path, e))?;
    let sha = {
        let mut h = Sha256::new();
        h.update(&bytes);
        format!("{:x}", h.finalize())
    };
    let mime = infer::get(&bytes)
        .map(|t| t.mime_type().to_string())
        .unwrap_or_else(|| "application/octet-stream".to_string());
    report.sha256 = sha.clone();
    prog(on_progress, Stage::Hash, Some(format!("{} bytes, {}", bytes.len(), mime)));

    // --- Step 2: resolve case + register source_files (status 'hashing') ----
    let case_uuid = pg::resolve_case_id(&state.pg, case_id).await?;
    let filename = Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "upload.bin".into());

    let file_id = pg::register_source_file(
        &state.pg,
        &case_uuid,
        &filename,
        &mime,
        bytes.len() as i64,
        &sha,
        source,
        "hashing",
    )
    .await?;
    report.file_id = file_id.clone();

    let job_id = pg::create_ingest_job(&state.pg, &file_id, "hashing").await?;
    report.job_id = job_id;
    prog(on_progress, Stage::Register, Some(format!("case {case_uuid}, file {file_id}")));

    // --- Step 3: upload blob to Supabase Storage ---------------------------
    // Compensation on failure: delete the rows we just wrote, then abort.
    let storage_key = format!("cases/{}/{}", case_uuid, file_id);
    let storage = state
        .storage
        .as_ref()
        .ok_or_else(|| "Supabase Storage not configured (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)".to_string())?;
    match storage.upload(&storage_key, &bytes, &mime).await {
        Ok(()) => {
            pg::set_source_file_storage(&state.pg, &file_id, &storage_key, &mime, bytes.len() as i64)
                .await?;
            report.storage_key = Some(storage_key.clone());
            prog(on_progress, Stage::Upload, Some(storage_key.clone()));
        }
        Err(e) => {
            let _ = pg::delete_source_file(&state.pg, &file_id).await;
            let _ = pg::delete_ingest_job(&state.pg, job_id).await;
            return Err(format!("blob upload failed: {e} (rolled back source_files)"));
        }
    }

    // --- Step 4: anchor file hash on the ledger (best-effort) --------------
    let case_code = pg::get_case_code(&state.pg, &case_uuid).await.unwrap_or_default();
    match crate::ledger::anchor(&state, &file_id, &sha, &case_code, source, &state.badge).await {
        Ok(tx) => {
            pg::set_source_file_ledger(&state.pg, &file_id, Some(&tx), "anchored", Some("stored"))
                .await?;
            report.ledger_tx_id = Some(tx);
            report.ledger_anchored = true;
        }
        Err(_) => {
            // §6.1 step 4: ledger down must NOT block ingest.
            pg::set_source_file_ledger(&state.pg, &file_id, None, "pending", Some("stored"))
                .await?;
            report.ledger_anchored = false;
        }
    }
    prog(on_progress, Stage::Anchor, if report.ledger_anchored { Some("anchored".into()) } else { Some("pending (ledger down)".into()) });

    // --- Steps 6/7: extraction (Backlog #3) --------------------------------
    // The NLP engine is wired but optional here: if it is unreachable we fall
    // back to a document-only ingest so the saga still commits.
    let extraction = try_extract(state, path, &mime, &file_id).await;
    let needs_review = extraction.as_ref().map(|e| e.needs_review).unwrap_or(false);
    prog(on_progress, Stage::Extract, if needs_review {
        Some("needs_review (LLM output invalid)".into())
    } else if extraction.is_some() {
        Some(format!("extracted via {}", extraction.as_ref().unwrap().engine))
    } else {
        Some("skipped (engine offline)".into())
    });

    // --- Step 8: persist entities/identifiers/relationships/evidence -------
    let (entities, relationships) = if let Some(ex) = extraction.as_ref() {
        if ex.needs_review {
            // D11 quarantine: flag for human review, do NOT persist the data.
            let _ = pg::set_source_file_status(&state.pg, &file_id, "needs_review").await;
            let _ = pg::update_ingest_job(
                &state.pg, job_id, "extracting", "needs_review",
                Some("NLP output failed schema validation after D11 repair retry"),
                ex.attempts as i16,
            )
            .await;
            (0usize, 0usize)
        } else {
            match pg::persist_extraction(&state.pg, &case_uuid, &file_id, ex).await {
                Ok(()) => {
                    prog(on_progress, Stage::Persist, Some(format!(
                        "{} entities, {} relations, {} evidence",
                        ex.entities.len(), ex.relations.len(), ex.evidence.len())));
                    (ex.entities.len(), ex.relations.len())
                }
                Err(e) => {
                    let _ = pg::update_ingest_job(
                        &state.pg, job_id, "persisting", "failed", Some(&e), 0,
                    ).await;
                    (0, 0)
                }
            }
        }
    } else {
        (0, 0)
    };

    // --- Step 9: Neo4j MERGE (document node always; entities when present) --
    let neo_ok = if needs_review {
        false
    } else {
        merge_graph(state, &case_uuid, &file_id, &filename, &sha, extraction.as_ref()).await
    };
    report.neo4j_synced = neo_ok;
    prog(on_progress, Stage::Graph, if neo_ok { Some("synced".into()) } else if needs_review { Some("skipped (needs_review)".into()) } else { Some("pending (neo4j down)".into()) });

    // --- Step 10: anchor the extraction result on the ledger (best-effort) -
    let extraction_hash = {
        let mut h = Sha256::new();
        h.update(sha.as_bytes());
        h.update(format!("e={entities};r={relationships}").as_bytes());
        format!("{:x}", h.finalize())
    };
    let _ = crate::ledger::log_action(
        &state,
        &uuid::Uuid::new_v4().to_string(),
        "file.committed",
        "source_file",
        &file_id,
        &extraction_hash,
        &state.badge,
    )
    .await;

    // --- Step 11: audit emit + finalize ------------------------------------
    crate::audit::emit(&state, "file.read", "source_file", &file_id, &sha).await?;
    prog(on_progress, Stage::Audit, None);

    if needs_review {
        // Document is stored but the extraction was quarantined (D11). Leave
        // the `needs_review` status so the human-in-the-loop queue can pick it
        // up; the file itself is fully committed to storage + ledger.
        let _ = pg::update_ingest_job(&state.pg, job_id, "committed", "needs_review", None, 0).await;
    } else {
        let _ = pg::update_ingest_job(&state.pg, job_id, "committed", "ok", None, 0).await;
        let _ = pg::set_source_file_status(&state.pg, &file_id, "committed").await;
    }

    report.entities = entities;
    report.relationships = relationships;
    prog(on_progress, Stage::Done, Some(format!("job {job_id} committed")));
    Ok(report)
}

/// Merge the document node and (if present) extracted entities/relationships.
/// Returns `true` only if the document node merged successfully. Entity/relation
/// merges are best-effort: a single failure does not fail the whole graph step.
async fn merge_graph(
    state: &AppState,
    case_id: &str,
    file_id: &str,
    name: &str,
    sha: &str,
    extraction: Option<&Extraction>,
) -> bool {
    if state.neo.is_none() {
        return false;
    }
    if crate::db::neo4j::merge_document(state, case_id, file_id, name, sha)
        .await
        .is_err()
    {
        return false;
    }
    if let Some(ex) = extraction {
        for e in &ex.entities {
            let _ = crate::db::neo4j::merge_entity(state, case_id, &e.id, &e.etype, &e.name).await;
        }
        for r in &ex.relations {
            let _ = crate::db::neo4j::merge_relationship(
                state, case_id, &r.id, &r.src, &r.dst, &r.rtype, r.weight, r.evidence_count, None,
            )
            .await;
        }
    }
    true
}

/// Best-effort NLP extraction hook (Backlog #3).
///
/// Posts the file (path + MIME + doc id) to the Python engine's `/nlp/extract`
/// endpoint and maps the engine-agnostic result into our `Extraction` model.
/// Returns `None` only when the engine URL is unset/unreachable — in that case
/// the saga proceeds as a document-only ingest. A `needs_review` status from the
/// engine (D11: schema validation failed after the repair retry) is surfaced as
/// `Extraction { needs_review: true }` so the saga can quarantine the document.
async fn try_extract(
    state: &AppState,
    path: &str,
    mime: &str,
    file_id: &str,
) -> Option<Extraction> {
    let base = std::env::var("RAVEN_ENGINE_URL").ok()?;
    let url = format!("{}/nlp/extract", base.trim_end_matches('/'));
    let abs_path = std::fs::canonicalize(path)
        .map(|p| p.to_string_lossy().to_string().replace(r"\\?\", ""))
        .unwrap_or_else(|_| path.to_string());
    let resp = state
        .http
        .post(&url)
        .json(&serde_json::json!({
            "file_path": abs_path,
            "mime": mime,
            "doc_id": file_id,
            "dpi": 300,
        }))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body: serde_json::Value = resp.json().await.ok()?;

    let mut ex = Extraction::default();
    ex.engine = body
        .get("engine")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    ex.attempts = body.get("attempts").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    ex.text = body.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
    ex.page_map = body.get("page_map").cloned();

    if body.get("status").and_then(|v| v.as_str()) == Some("needs_review") {
        ex.needs_review = true;
        return Some(ex);
    }

    if let Some(arr) = body.get("entities").and_then(|v| v.as_array()) {
        for e in arr {
            let id = get_str(e, "id");
            let name = get_str(e, "name");
            if id.is_empty() || name.is_empty() {
                continue;
            }
            let aliases = e
                .get("aliases")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            ex.entities.push(ExtractedEntity {
                id,
                etype: normalize_entity_type(&get_str(e, "type")),
                name,
                aliases,
                role: get_str(e, "role"),
            });
        }
    }
    if let Some(arr) = body.get("identifiers").and_then(|v| v.as_array()) {
        for i in arr {
            let id = get_str(i, "id");
            let value = get_str(i, "value");
            if id.is_empty() || value.is_empty() {
                continue;
            }
            let itype = normalize_identifier_type(&get_str(i, "type"));
            if itype.is_empty() {
                continue; // not a valid identifier enum -> skip
            }
            let entity_id = i
                .get("entity_id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            ex.identifiers.push(ExtractedIdentifier {
                id,
                entity_id,
                itype,
                value,
            });
        }
    }
    if let Some(arr) = body.get("relations").and_then(|v| v.as_array()) {
        for r in arr {
            let id = get_str(r, "id");
            let src = get_str(r, "src");
            let dst = get_str(r, "dst");
            if id.is_empty() || src.is_empty() || dst.is_empty() {
                continue;
            }
            let rtype = normalize_rel_type(&get_str(r, "type"));
            if rtype.is_empty() {
                continue; // not a valid rel_type enum -> skip
            }
            let weight = r.get("confidence").and_then(|v| v.as_f64()).unwrap_or(0.0);
            ex.relations.push(ExtractedRelation {
                id,
                src,
                dst,
                rtype,
                weight,
                evidence_count: 1,
            });
        }
    }
    if let Some(arr) = body.get("evidence").and_then(|v| v.as_array()) {
        for ev in arr {
            let kind = get_str(ev, "kind");
            let snippet = get_str(ev, "snippet");
            let rid = ev
                .get("relationship_id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let eid = ev
                .get("entity_id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            if rid.is_none() && eid.is_none() {
                continue;
            }
            ex.evidence.push(ExtractedEvidence {
                relationship_id: rid,
                entity_id: eid,
                kind,
                snippet,
                char_start: ev.get("char_start").and_then(|v| v.as_i64()),
                char_end: ev.get("char_end").and_then(|v| v.as_i64()),
            });
        }
    }

    if ex.entities.is_empty() && ex.relations.is_empty() && ex.evidence.is_empty() {
        // Engine reachable but produced nothing useful -> doc-only ingest
        // (do not quarantine; just skip the persist/graph steps).
        None
    } else {
        Some(ex)
    }
}

fn get_str(v: &serde_json::Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn normalize_entity_type(s: &str) -> String {
    match s.to_uppercase().as_str() {
        "PERSON" | "ORGANIZATION" | "LOCATION" | "VEHICLE" | "ACCOUNT" => s.to_uppercase(),
        _ => "PERSON".to_string(),
    }
}

fn normalize_identifier_type(s: &str) -> String {
    match s.to_uppercase().as_str() {
        "PHONE" | "VEHICLE" | "ACCOUNT" | "IMEI" | "NAFIS" => s.to_uppercase(),
        _ => String::new(),
    }
}

fn normalize_rel_type(s: &str) -> String {
    match s.to_uppercase().as_str() {
        "CALLED" | "TRANSFERRED_TO" | "CO_ACCUSED" | "CO_LOCATED" | "RESIDES_WITH"
        | "SEEN_WITH" => s.to_uppercase(),
        _ => String::new(),
    }
}
