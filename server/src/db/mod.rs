//! Postgres (source of truth) and Neo4j (derived projection) access.
//!
//! Only this server writes to Neo4j (D10); engine nodes hold read-only Bolt
//! credentials for topology queries only.
//!
//! D33: the ingest saga background worker talks to Postgres through
//! [`SagaDb`], a thin wrapper over a `sqlx` pool opened on
//! `SAGA_DATABASE_URL` with the dedicated `raven_saga` role — never the
//! service-role key, never a user JWT. The pool is lazy: it is created
//! without connecting, so a down database fails per-operation (visible
//! job rows / error responses, rule 9) rather than wedging startup.
//!
//! RLS caveat (recorded, not silently worked around — see the D33
//! amendment in `docs/DECISIONS.md`): the baseline RLS policies key on
//! `auth.uid()`, which is NULL in background sessions, so the GRANTs
//! alone do not yet make the saga effective. Owner transfer or
//! equivalent is a follow-up decision; every method here surfaces the
//! denial as an `Err`, never an empty success.

use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::files::{NewSourceFile, RepoError, RepoFile, SourceFileRepo};
use crate::saga::ingest::{CaseDb, LedgerOutcome, PersistBatch, PersistError, PersistedIds, Provenance};

/// Saga database failure. Always surfaced — as an HTTP error envelope
/// on the request path, or a failed `ingest_jobs` row in the saga.
#[derive(Debug, thiserror::Error)]
pub enum SagaDbError {
    #[error("saga database unavailable: {0}")]
    Unavailable(String),
    #[error("saga query failed: {0}")]
    Query(String),
}

impl From<sqlx::Error> for SagaDbError {
    fn from(error: sqlx::Error) -> Self {
        SagaDbError::Query(error.to_string())
    }
}

/// Postgres handle for the ingest saga (D33). Cheap to clone (the pool
/// is reference-counted); every method takes `&self`, matching the
/// saga traits' `&self` shape so one value serves both the handler path
/// and `tokio::spawn` without locking.
#[derive(Debug, Clone)]
pub struct SagaDb {
    pool: PgPool,
}

impl SagaDb {
    /// Open the lazy pool. No I/O happens here; the first query
    /// connects (or fails loudly at that point).
    pub fn connect_lazy(url: &str) -> Result<Self, SagaDbError> {
        PgPool::connect_lazy(url)
            .map(|pool| Self { pool })
            .map_err(|error| SagaDbError::Unavailable(error.to_string()))
    }

    /// Open the pool from the environment (D33). No code default: the
    /// saga must never silently run against the wrong database.
    pub fn from_env() -> Result<Self, String> {
        let url = std::env::var("SAGA_DATABASE_URL").map_err(|_| {
            "SAGA_DATABASE_URL is not set: the ingest saga needs its raven_saga role \
             credentials (docs/DECISIONS.md D33, docs/DEPLOYMENT.md)"
                .to_string()
        })?;
        Self::connect_lazy(&url).map_err(|error| error.to_string())
    }

    /// Current status label of one file.
    pub async fn file_status(&self, file_id: &Uuid) -> Result<Option<String>, SagaDbError> {
        let row: Option<(String,)> = sqlx::query_as(
            "SELECT status::text FROM source_files WHERE id = $1",
        )
        .bind(file_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|row| row.0))
    }

    /// Set one file's status.
    pub async fn set_status(&self, file_id: &Uuid, status: &str) -> Result<(), SagaDbError> {
        sqlx::query("UPDATE source_files SET status = $2::ingest_status WHERE id = $1")
            .bind(file_id)
            .bind(status)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Case, uploader and identity material the saga needs before any
    /// ledger call (D33: both come from the database, never the wire).
    pub async fn file_context(
        &self,
        file_id: &Uuid,
    ) -> Result<Option<FileContext>, SagaDbError> {
        let row: Option<(Uuid, Option<Uuid>, String)> = sqlx::query_as(
            "SELECT case_id, uploaded_by, provenance::text FROM source_files WHERE id = $1",
        )
        .bind(file_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|(case_id, uploaded_by, provenance)| FileContext {
            case_id,
            uploaded_by,
            provenance,
        }))
    }

    /// Fabric identity of the uploading user, if the org has issued one.
    pub async fn ledger_id_for(
        &self,
        user_id: &Uuid,
    ) -> Result<Option<String>, SagaDbError> {
        let row: Option<(Option<String>,)> =
            sqlx::query_as("SELECT ledger_id FROM profiles WHERE id = $1")
                .bind(user_id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.and_then(|row| row.0))
    }

    /// File-hash anchor succeeded (D5 step 4/5).
    pub async fn anchor_file_success(
        &self,
        file_id: &Uuid,
        tx_id: &str,
    ) -> Result<(), SagaDbError> {
        sqlx::query(
            "UPDATE source_files SET ledger_tx_id = $2, ledger_status = 'anchored' \
             WHERE id = $1",
        )
        .bind(file_id)
        .bind(tx_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// File-hash anchor failed: pending, ingest continues (D5).
    pub async fn anchor_file_pending(&self, file_id: &Uuid) -> Result<(), SagaDbError> {
        sqlx::query("UPDATE source_files SET ledger_status = 'pending' WHERE id = $1")
            .bind(file_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Uploader has no Fabric identity yet: same marker as the decide
    /// endpoints (D33), ingest continues.
    pub async fn anchor_file_skipped(&self, file_id: &Uuid) -> Result<(), SagaDbError> {
        sqlx::query(
            "UPDATE source_files SET ledger_status = 'skipped_no_identity' WHERE id = $1",
        )
        .bind(file_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// One `ingest_jobs` row for a finished stage.
    ///
    /// Rule 3 (D16) note: `started_at`/`finished_at` are infrastructure
    /// event times — when the worker ran — not case data. Case
    /// timestamps live on evidence rows and sightings via the case
    /// clock. `now_utc()` is correct here for the same reason it is
    /// correct on `audit_log` rows.
    pub async fn write_job(
        &self,
        file_id: &Uuid,
        stage: &str,
        status: &str,
        error_detail: Option<&str>,
    ) -> Result<(), SagaDbError> {
        let now = OffsetDateTime::now_utc();
        sqlx::query(
            "INSERT INTO ingest_jobs (file_id, stage, status, error_detail, started_at, finished_at) \
             VALUES ($1, $2, $3::text, $4, $5, $6)",
        )
        .bind(file_id)
        .bind(stage)
        .bind(status)
        .bind(error_detail)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Store recognised/extracted text and move the file to the next
    /// status in one row write.
    pub async fn set_extracted_text(
        &self,
        file_id: &Uuid,
        text: &str,
        status: &str,
    ) -> Result<(), SagaDbError> {
        sqlx::query(
            "UPDATE source_files SET extracted_text = $2, status = $3::ingest_status \
             WHERE id = $1",
        )
        .bind(file_id)
        .bind(text)
        .bind(status)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Queue a structured file for human schema-mapping review (D36
    /// amendment: the marker reuses existing columns — there is no
    /// `kind` column and this session adds none).
    pub async fn insert_structured_review(
        &self,
        file_id: &Uuid,
        blob_path: &str,
    ) -> Result<(), SagaDbError> {
        sqlx::query(
            "INSERT INTO review_items \
             (source_file_id, field_name, script, crop_path, recognised_text, status) \
             VALUES ($1, 'structured_import', 'Zyyy', $2, NULL, 'pending')",
        )
        .bind(file_id)
        .bind(blob_path)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

/// Case, uploader identity and provenance for one file (D33 ledger
/// reads; provenance feeds the handoff batch so rule 7 holds).
#[derive(Debug, Clone)]
pub struct FileContext {
    pub case_id: Uuid,
    pub uploaded_by: Option<Uuid>,
    pub provenance: String,
}

#[async_trait::async_trait]
impl SourceFileRepo for SagaDb {
    async fn find_by_sha256(&self, sha256: &str) -> Result<Option<RepoFile>, RepoError> {
        sqlx::query_as::<_, RepoFile>(
            "SELECT id, case_id, sha256, mime_type, status::text AS status \
             FROM source_files WHERE sha256 = $1 LIMIT 1",
        )
        .bind(sha256)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| RepoError::Db(error.to_string()))
    }

    async fn insert_file(&self, new: &NewSourceFile) -> Result<Uuid, RepoError> {
        // The id is handler-generated (see NewSourceFile): the row must
        // carry the same id the blob mirror, audit row and saga use.
        sqlx::query(
            "INSERT INTO source_files \
             (id, case_id, filename, mime_type, byte_size, sha256, storage_path, \
              source, provenance, status, uploaded_by) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::source_node, $9::provenance, \
                     'received', $10)",
        )
        .bind(new.id)
        .bind(new.case_id)
        .bind(&new.filename)
        .bind(&new.mime_type)
        .bind(new.byte_size)
        .bind(&new.sha256)
        .bind(&new.storage_path)
        .bind(&new.source_node)
        .bind(&new.provenance)
        .bind(new.uploaded_by)
        .execute(&self.pool)
        .await
        .map_err(|error| RepoError::Db(error.to_string()))?;
        Ok(new.id)
    }

    async fn find_by_id(&self, file_id: &Uuid) -> Result<Option<RepoFile>, RepoError> {
        sqlx::query_as::<_, RepoFile>(
            "SELECT id, case_id, sha256, mime_type, status::text AS status \
             FROM source_files WHERE id = $1",
        )
        .bind(file_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| RepoError::Db(error.to_string()))
    }

    async fn reset_for_retry(&self, file_id: &Uuid) -> Result<(), RepoError> {
        sqlx::query(
            "UPDATE source_files SET status = 'received', ledger_tx_id = NULL, \
             ledger_status = 'pending' WHERE id = $1",
        )
        .bind(file_id)
        .execute(&self.pool)
        .await
        .map(|_| ())
        .map_err(|error| RepoError::Db(error.to_string()))
    }
}

#[async_trait::async_trait]
impl crate::api::cases::CaseTable for SagaDb {
    async fn insert_case_row(&self, id: &Uuid, case_code: &str, title: &str) -> Result<(), String> {
        sqlx::query("INSERT INTO cases (id, case_code, title) VALUES ($1, $2, $3)")
            .bind(id)
            .bind(case_code)
            .bind(title)
            .execute(&self.pool)
            .await
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    /// Startup rehydration source for `CaseStore` (session request: the
    /// in-memory list must survive a restart). Reads under the
    /// `saga_select` policy on `cases` -- unconditional, unlike the
    /// baseline `case_visible` policy user JWTs go through.
    async fn all_cases(&self) -> Result<Vec<crate::api::search::CaseRecord>, String> {
        sqlx::query_as::<_, crate::api::search::CaseRecord>(
            "SELECT id, case_code, title FROM cases",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| error.to_string())
    }

    /// Durable write behind `POST /cases/{id}/assignments`. `app_role`
    /// is a Postgres enum, not a type `sqlx` maps automatically, so it
    /// binds as text and casts server-side -- same convention as every
    /// other enum column in this file (`status::ingest_status`, etc.).
    async fn insert_assignment_row(
        &self,
        case_id: &Uuid,
        user_id: &Uuid,
        role: crate::auth::AppRole,
        assigned_by: &Uuid,
    ) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO case_assignments (case_id, user_id, assigned_role, assigned_by) \
             VALUES ($1, $2, $3::app_role, $4) \
             ON CONFLICT (case_id, user_id) DO UPDATE \
             SET assigned_role = EXCLUDED.assigned_role, assigned_by = EXCLUDED.assigned_by",
        )
        .bind(case_id)
        .bind(user_id)
        .bind(role.as_str())
        .bind(assigned_by)
        .execute(&self.pool)
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
    }

    /// Startup rehydration source for `AssignmentStore`.
    async fn all_assignments(&self) -> Result<Vec<crate::audit::Assignment>, String> {
        let rows: Vec<(Uuid, Uuid, String)> = sqlx::query_as(
            "SELECT case_id, user_id, assigned_role::text FROM case_assignments",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| error.to_string())?;
        rows.into_iter()
            .map(|(case_id, user_id, role_text)| {
                crate::auth::AppRole::parse(&role_text)
                    .map(|role| crate::audit::Assignment { case_id, user_id, role })
                    .ok_or_else(|| format!("unknown assigned_role {role_text:?} in case_assignments"))
            })
            .collect()
    }
}

#[async_trait::async_trait]
impl CaseDb for SagaDb {
    /// Step 9: ONE transaction — entities, identifiers, relationships,
    /// then evidence (D4: Postgres commits first and is the source of
    /// truth). Every row carries the file's provenance (rule 7); every
    /// evidence row carries its span (rule 8).
    ///
    /// Evidence linkage is positional by construction: `to_batch`
    /// emits exactly one evidence row per entity in entity order, so
    /// `evidence[i]` belongs to `entities[i]` and is stored with that
    /// entity's id. A length mismatch is a bug upstream — fail the
    /// batch loudly (rule 9) rather than misattributing spans.
    async fn persist_extraction(
        &self,
        file_id: Uuid,
        case_id: Uuid,
        provenance: Provenance,
        batch: PersistBatch,
    ) -> Result<PersistedIds, PersistError> {
        if batch.evidence.len() != batch.entities.len() {
            return Err(PersistError::Failed(format!(
                "evidence rows ({}) do not match entities ({}) for file {file_id}",
                batch.evidence.len(),
                batch.entities.len()
            )));
        }
        let mut tx = self.pool.begin().await.map_err(map_persist)?;
        let mut entity_ids = Vec::with_capacity(batch.entities.len());
        for entity in &batch.entities {
            let row: (Uuid,) = sqlx::query_as(
                "INSERT INTO entities (case_id, type, canonical_name, provenance) \
                 VALUES ($1, $2::entity_type, $3, $4::provenance) RETURNING id",
            )
            .bind(case_id)
            .bind(&entity.typ)
            .bind(&entity.canonical_name)
            .bind(provenance.as_str())
            .fetch_one(&mut *tx)
            .await
            .map_err(map_persist)?;
            entity_ids.push(row.0);
        }
        for identifier in &batch.identifiers {
            let entity_id = entity_ids.get(identifier.entity_index).copied().ok_or_else(|| {
                PersistError::Failed(format!(
                    "identifier {:?} points at missing entity {}",
                    identifier.value, identifier.entity_index
                ))
            })?;
            sqlx::query(
                "INSERT INTO identifiers (entity_id, type, value, source_file_id, provenance) \
                 VALUES ($1, $2::identifier_type, $3, $4, $5::provenance)",
            )
            .bind(entity_id)
            .bind(&identifier.typ)
            .bind(&identifier.value)
            .bind(file_id)
            .bind(provenance.as_str())
            .execute(&mut *tx)
            .await
            .map_err(map_persist)?;
        }
        let mut relationship_ids = Vec::with_capacity(batch.relationships.len());
        for rel in &batch.relationships {
            let src = entity_ids.get(rel.src_index).copied().ok_or_else(|| {
                PersistError::Failed(format!(
                    "relationship {} points outside {} entities",
                    rel.typ,
                    entity_ids.len()
                ))
            })?;
            let dst = entity_ids.get(rel.dst_index).copied().ok_or_else(|| {
                PersistError::Failed(format!(
                    "relationship {} points outside {} entities",
                    rel.typ,
                    entity_ids.len()
                ))
            })?;
            let row: (Uuid,) = sqlx::query_as(
                "INSERT INTO relationships \
                 (case_id, src_entity_id, dst_entity_id, type, provenance) \
                 VALUES ($1, $2, $3, $4::rel_type, $5::provenance) RETURNING id",
            )
            .bind(case_id)
            .bind(src)
            .bind(dst)
            .bind(&rel.typ)
            .bind(provenance.as_str())
            .fetch_one(&mut *tx)
            .await
            .map_err(map_persist)?;
            relationship_ids.push(row.0);
        }
        for (entity_id, evidence) in entity_ids.iter().zip(batch.evidence.iter()) {
            sqlx::query(
                "INSERT INTO evidence \
                 (entity_id, source_file_id, kind, snippet, char_start, char_end, \
                  page_no, occurred_at, confidence, provenance) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10::provenance)",
            )
            .bind(entity_id)
            .bind(file_id)
            .bind(&evidence.kind)
            .bind(&evidence.snippet)
            .bind(evidence.char_start)
            .bind(evidence.char_end)
            .bind(evidence.page_no)
            .bind(evidence.occurred_at)
            .bind(evidence.confidence.map(f64::from))
            .bind(provenance.as_str())
            .execute(&mut *tx)
            .await
            .map_err(map_persist)?;
        }
        tx.commit().await.map_err(map_persist)?;
        Ok(PersistedIds { entity_ids, relationship_ids })
    }

    async fn set_file_status(&self, file_id: Uuid, status: crate::saga::ingest::FileStatus) {
        // Status writes are fire-and-forget at this layer by prior
        // design (the trait returns nothing): a failure is logged, never
        // raised — the saga's own job rows remain the source of truth
        // for stage progress.
        if let Err(error) = self.set_status(&file_id, status.as_str()).await {
            tracing::warn!(%file_id, %error, "saga set_file_status failed; see ingest_jobs");
        }
    }

    /// M4-T4: call the baseline function, never rewrite it. The
    /// `::float8` cast only affects the returned copy — the function
    /// itself updates the row's `numeric` weight.
    async fn recompute_weight(
        &self,
        rel_id: Uuid,
        version: i32,
    ) -> Result<f64, crate::saga::ingest::WeightError> {
        use crate::saga::ingest::WeightError;
        let row: Result<(f64,), sqlx::Error> =
            sqlx::query_as("SELECT recompute_weight($1, $2)::float8")
                .bind(rel_id)
                .bind(version)
                .fetch_one(&self.pool)
                .await;
        match row {
            Ok(row) => Ok(row.0),
            Err(error) if error.to_string().contains("weight_params version") => {
                Err(WeightError::UnknownVersion(version))
            }
            Err(error) => Err(WeightError::Failed(error.to_string())),
        }
    }

    async fn mark_sync_pending(&self, entity_ids: &[Uuid], relationship_ids: &[Uuid]) {
        // Same fire-and-forget contract as set_file_status above.
        if !entity_ids.is_empty() {
            let result = sqlx::query("UPDATE entities SET sync_state = 'pending' WHERE id = ANY($1)")
                .bind(entity_ids)
                .execute(&self.pool)
                .await;
            if let Err(error) = result {
                tracing::warn!(%error, "saga mark_sync_pending(entities) failed");
            }
        }
        if !relationship_ids.is_empty() {
            let result = sqlx::query(
                "UPDATE relationships SET sync_state = 'pending' WHERE id = ANY($1)",
            )
            .bind(relationship_ids)
            .execute(&self.pool)
            .await;
            if let Err(error) = result {
                tracing::warn!(%error, "saga mark_sync_pending(relationships) failed");
            }
        }
    }

    /// Extraction-anchor outcome (D5 step 11).
    ///
    /// Stored as an `ingest_jobs` `handoff` row — deliberately NOT as
    /// `source_files.ledger_tx_id`, which the verify flow needs for the
    /// *file* anchor: overwriting it would compare file bytes against
    /// the extraction hash and false-positive tamper (see the D33
    /// amendment). The anchoring tx id rides in `error_detail` on
    /// success so both transaction ids stay queryable (D5).
    async fn record_ledger(&self, file_id: Uuid, outcome: &LedgerOutcome) {
        let (status, detail) = match outcome {
            LedgerOutcome::Anchored(tx_id) => ("ok", Some(tx_id.as_str())),
            LedgerOutcome::PendingRetry(reason) => ("failed", Some(reason.as_str())),
        };
        if let Err(error) = self.write_job(&file_id, "handoff", status, detail).await {
            tracing::warn!(%file_id, %error, "saga record_ledger failed; see ingest_jobs");
        }
    }
}

fn map_persist(error: sqlx::Error) -> PersistError {
    PersistError::Failed(error.to_string())
}
