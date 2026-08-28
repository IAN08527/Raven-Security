use sqlx::postgres::PgPoolOptions;
use sqlx::ConnectOptions;
use sqlx::PgPool;

use crate::model::Extraction;

/// Build a Postgres DSN for the Raven cloud Supabase project.
///
/// Priority:
///   1. `RAVEN_PG_DSN` if set (full DSN, supports the Supabase connection pooler).
///   2. Assembled from the `SUPABASE_*` env vars. When a `SUPABASE_PROJECT_REF`
///      is present and the pooler host is used, the role is suffixed with the
///      project ref (`postgres.<ref>`) as required by Supabase's shared pooler.
pub fn build_pg_dsn() -> String {
    if let Ok(dsn) = std::env::var("RAVEN_PG_DSN") {
        if !dsn.is_empty() {
            return dsn;
        }
    }

    let host = std::env::var("SUPABASE_DB_HOST")
        .unwrap_or_else(|_| "db.nszgciwmpdejpvoywgav.supabase.co".to_string());
    let port = std::env::var("SUPABASE_DB_PORT").unwrap_or_else(|_| "5432".to_string());
    let password = std::env::var("SUPABASE_DB_PASSWORD").unwrap_or_default();
    let db = std::env::var("SUPABASE_DB_NAME").unwrap_or_else(|_| "postgres".to_string());
    let project_ref = std::env::var("SUPABASE_PROJECT_REF").unwrap_or_default();

    let user = std::env::var("SUPABASE_DB_USER").unwrap_or_else(|_| "postgres".to_string());
    let role = if !project_ref.is_empty() && !host.contains("pooler.supabase.co") {
        user
    } else if host.contains("pooler.supabase.co") && !user.contains('.') {
        format!("{}.{}", user, project_ref)
    } else {
        user
    };

    format!(
        "postgresql://{}:{}@{}:{}/{}",
        role,
        urlencode_password(&password),
        host,
        port,
        db
    )
}

/// Minimal URL-encoding for the password component of a DSN (handles `@ : / ? #`).
fn urlencode_password(pw: &str) -> String {
    let mut out = String::with_capacity(pw.len());
    for b in pw.bytes() {
        match b {
            b'@' => out.push_str("%40"),
            b':' => out.push_str("%3A"),
            b'/' => out.push_str("%2F"),
            b'?' => out.push_str("%3F"),
            b'#' => out.push_str("%23"),
            b'%' => out.push_str("%25"),
            _ => out.push(b as char),
        }
    }
    out
}

/// Create a lazy connection pool for the cloud Supabase Postgres instance.
///
/// `statement_cache_capacity(0)` keeps us PgBouncer/pooler-safe: no server-side
/// prepared statements, which the transaction-pooler mode does not support.
pub fn create_pool() -> Result<PgPool, sqlx::Error> {
    let dsn = build_pg_dsn();
    let url = dsn
        .parse::<url::Url>()
        .map_err(|e| sqlx::Error::Configuration(Box::new(e)))?;
    let opts = sqlx::postgres::PgConnectOptions::from_url(&url)?
        .statement_cache_capacity(0);

    Ok(PgPoolOptions::new()
        .max_connections(5)
        .idle_timeout(std::time::Duration::from_secs(30))
        .acquire_timeout(std::time::Duration::from_secs(8))
        .connect_lazy_with(opts))
}

/// Real liveness probe: `SELECT 1`. Drives the "supabase" row in the health gate.
pub async fn pg_health(pool: &PgPool) -> bool {
    matches!(
        sqlx::query_scalar::<_, i32>("SELECT 1")
            .persistent(false)
            .fetch_one(pool)
            .await,
        Ok(1)
    )
}

pub async fn count_source_files(pool: &PgPool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>("SELECT count(*) FROM source_files")
        .persistent(false)
        .fetch_one(pool)
        .await
}

#[derive(Debug, serde::Serialize)]
pub struct CaseRow {
    pub id: String,
    pub case_code: String,
    pub title: String,
}

pub async fn list_cases(pool: &PgPool) -> Result<Vec<CaseRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, (String, String, String)>(
        "SELECT id::text, case_code, title FROM cases ORDER BY opened_at DESC LIMIT 50",
    )
    .persistent(false)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, case_code, title)| CaseRow { id, case_code, title })
        .collect())
}

/// Insert a case if it does not already exist (used by test harnesses).
pub async fn ensure_case(pool: &PgPool, case_code: &str, title: &str) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO cases (id, case_code, title) VALUES (gen_random_uuid(), $1, $2) \
         ON CONFLICT (case_code) DO NOTHING",
    )
    .bind(case_code)
    .bind(title)
    .persistent(false)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Verify the Raven schema is present by counting our core tables.
pub async fn schema_present(pool: &PgPool) -> Result<bool, sqlx::Error> {
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM information_schema.tables \
         WHERE table_schema='public' AND table_name IN \
         ('officers','cases','source_files','entities','relationships',\
          'evidence','cdr_records','financial_txns','anomalies','audit_log','reid_targets')",
    )
    .persistent(false)
    .fetch_one(pool)
    .await?;
    Ok(count >= 11)
}

/// Resolve a case id that may be either a UUID or a `case_code` to a UUID string.
pub async fn resolve_case_id(pool: &PgPool, case_id: &str) -> Result<String, String> {
    if let Ok(u) = uuid::Uuid::parse_str(case_id) {
        let exists: Option<String> = sqlx::query_scalar("SELECT id::text FROM cases WHERE id = $1::uuid")
            .bind(u)
            .persistent(false)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
        if let Some(id) = exists {
            return Ok(id);
        }
    }
    let by_code: Option<String> = sqlx::query_scalar("SELECT id::text FROM cases WHERE case_code = $1")
        .bind(case_id)
        .persistent(false)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    by_code.ok_or_else(|| format!("case not found: {case_id}"))
}

pub async fn get_case_code(pool: &PgPool, case_uuid: &str) -> Result<String, String> {
    let code: Option<String> = sqlx::query_scalar("SELECT case_code FROM cases WHERE id = $1::uuid")
        .bind(case_uuid)
        .persistent(false)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    code.ok_or_else(|| "case code not found".to_string())
}

/// Validate a `source_node` enum value; default to `MANUAL` if unknown.
fn normalize_source(s: &str) -> String {
    const OK: [&str; 7] = [
        "CCTNS", "CFCFRMS", "ICJS", "VAHAN", "NAFIS", "TELECOM", "MANUAL",
    ];
    if OK.contains(&s) {
        s.to_string()
    } else {
        "MANUAL".to_string()
    }
}

/// Insert a `source_files` row in a given `ingest_status` and return its id.
pub async fn register_source_file(
    pool: &PgPool,
    case_id: &str,
    filename: &str,
    mime: &str,
    size: i64,
    sha256: &str,
    source: &str,
    status: &str,
) -> Result<String, String> {
    let id: String = sqlx::query_scalar(
        "INSERT INTO source_files \
         (id, case_id, filename, mime_type, byte_size, sha256, storage_path, source, status) \
         VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, '', $6::source_node, $7::ingest_status) \
         RETURNING id::text",
    )
    .bind(case_id)
    .bind(filename)
    .bind(mime)
    .bind(size)
    .bind(sha256)
    .bind(normalize_source(source))
    .bind(status)
    .persistent(false)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

pub async fn set_source_file_storage(
    pool: &PgPool,
    file_id: &str,
    storage_path: &str,
    mime: &str,
    size: i64,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE source_files SET storage_path=$2, mime_type=$3, byte_size=$4 WHERE id=$1::uuid",
    )
    .bind(file_id)
    .bind(storage_path)
    .bind(mime)
    .bind(size)
    .persistent(false)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn set_source_file_ledger(
    pool: &PgPool,
    file_id: &str,
    tx: Option<&str>,
    ledger_status: &str,
    status: Option<&str>,
) -> Result<(), String> {
    if let Some(st) = status {
        sqlx::query(
            "UPDATE source_files SET ledger_tx_id=$2, ledger_status=$3, status=$4::ingest_status \
             WHERE id=$1::uuid",
        )
        .bind(file_id)
        .bind(tx)
        .bind(ledger_status)
        .bind(st)
        .persistent(false)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    } else {
        sqlx::query("UPDATE source_files SET ledger_tx_id=$2, ledger_status=$3 WHERE id=$1::uuid")
            .bind(file_id)
            .bind(tx)
            .bind(ledger_status)
            .persistent(false)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn set_source_file_status(pool: &PgPool, file_id: &str, status: &str) -> Result<(), String> {
    sqlx::query("UPDATE source_files SET status=$2::ingest_status WHERE id=$1::uuid")
        .bind(file_id)
        .bind(status)
        .persistent(false)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn delete_source_file(pool: &PgPool, file_id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM source_files WHERE id=$1::uuid")
        .bind(file_id)
        .persistent(false)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Create an `ingest_jobs` row and return its bigserial id.
pub async fn create_ingest_job(pool: &PgPool, file_id: &str, stage: &str) -> Result<i64, String> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO ingest_jobs (file_id, stage, status) VALUES ($1::uuid, $2, 'running') \
         RETURNING id",
    )
    .bind(file_id)
    .bind(stage)
    .persistent(false)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

pub async fn update_ingest_job(
    pool: &PgPool,
    job_id: i64,
    stage: &str,
    status: &str,
    error_detail: Option<&str>,
    llm_attempts: i16,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE ingest_jobs SET stage=$2, status=$3, error_detail=$4, llm_attempts=$5, \
         finished_at = CASE WHEN $3 IN ('ok','failed') THEN now() ELSE finished_at END \
         WHERE id=$1",
    )
    .bind(job_id)
    .bind(stage)
    .bind(status)
    .bind(error_detail)
    .bind(llm_attempts)
    .persistent(false)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn delete_ingest_job(pool: &PgPool, job_id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM ingest_jobs WHERE id=$1")
        .bind(job_id)
        .persistent(false)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn get_ingest_job(
    pool: &PgPool,
    job_id: i64,
) -> Result<(String, String, Option<String>), String> {
    let row: Option<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT stage, status, error_detail FROM ingest_jobs WHERE id=$1",
    )
    .bind(job_id)
    .persistent(false)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    row.map(|r| (r.0, r.1, r.2))
        .ok_or_else(|| "job not found".to_string())
}

/// Persist an NLP extraction into Postgres (entities + identifiers +
/// relationships + evidence) inside one transaction (architecture §6.1 step 8).
/// Idempotent via `ON CONFLICT`. Also stashes the extracted text + page map on
/// `source_files` so the evidence panel can resolve spans. Wrapped in a
/// transaction so a mid-batch failure rolls everything back.
pub async fn persist_extraction(
    pool: &PgPool,
    case_id: &str,
    file_id: &str,
    ex: &Extraction,
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;

    for e in &ex.entities {
        sqlx::query(
            "INSERT INTO entities (id, case_id, type, canonical_name, sync_state) \
             VALUES ($1::uuid, $2::uuid, $3::entity_type, $4, 'pending') \
             ON CONFLICT (id) DO UPDATE SET canonical_name = EXCLUDED.canonical_name",
        )
        .bind(&e.id)
        .bind(case_id)
        .bind(&e.etype)
        .bind(&e.name)
        .persistent(false)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        for alias in &e.aliases {
            let norm = alias.to_lowercase();
            sqlx::query(
                "INSERT INTO entity_aliases (entity_id, alias, normalized) \
                 VALUES ($1::uuid, $2, $3) ON CONFLICT (entity_id, normalized) DO NOTHING",
            )
            .bind(&e.id)
            .bind(alias)
            .bind(&norm)
            .persistent(false)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    for i in &ex.identifiers {
        let Some(eid) = i.entity_id.as_ref().filter(|s| !s.is_empty()) else {
            continue;
        };
        sqlx::query(
            "INSERT INTO identifiers (entity_id, type, value, source_file_id) \
             VALUES ($1::uuid, $2::identifier_type, $3, $4::uuid) \
             ON CONFLICT (type, value, entity_id) DO NOTHING",
        )
        .bind(eid)
        .bind(&i.itype)
        .bind(&i.value)
        .bind(file_id)
        .persistent(false)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    for r in &ex.relations {
        sqlx::query(
            "INSERT INTO relationships \
             (id, case_id, src_entity_id, dst_entity_id, type, weight, raw_score, evidence_count, sync_state) \
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::rel_type, $6, $6, $7, 'pending') \
             ON CONFLICT (src_entity_id, dst_entity_id, type) \
             DO UPDATE SET weight = EXCLUDED.weight, raw_score = EXCLUDED.weight, \
                           evidence_count = EXCLUDED.evidence_count",
        )
        .bind(&r.id)
        .bind(case_id)
        .bind(&r.src)
        .bind(&r.dst)
        .bind(&r.rtype)
        .bind(r.weight)
        .bind(r.evidence_count)
        .persistent(false)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    for ev in &ex.evidence {
        sqlx::query(
            "INSERT INTO evidence (relationship_id, entity_id, source_file_id, kind, snippet, char_start, char_end) \
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7)",
        )
        .bind(ev.relationship_id.as_deref())
        .bind(ev.entity_id.as_deref())
        .bind(file_id)
        .bind(&ev.kind)
        .bind(&ev.snippet)
        .bind(ev.char_start)
        .bind(ev.char_end)
        .persistent(false)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Stash the extracted text + page map so spans stay resolvable (§5.2).
    sqlx::query("UPDATE source_files SET extracted_text=$2, page_map=$3 WHERE id=$1::uuid")
        .bind(file_id)
        .bind(&ex.text)
        .bind(ex.page_map.as_ref())
        .persistent(false)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[allow(dead_code)]
pub async fn insert_source_file(
    pool: &PgPool,
    case_id: &str,
    filename: &str,
    mime: &str,
    size: i64,
    sha256: &str,
    storage_path: &str,
    source: &str,
) -> Result<String, sqlx::Error> {
    let id: String = sqlx::query_scalar(
        "INSERT INTO source_files \
         (id, case_id, filename, mime_type, byte_size, sha256, storage_path, source) \
         VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, $6, $7) \
         RETURNING id::text",
    )
    .bind(case_id)
    .bind(filename)
    .bind(mime)
    .bind(size)
    .bind(sha256)
    .bind(storage_path)
    .bind(normalize_source(source))
    .persistent(false)
    .fetch_one(pool)
    .await?;
    Ok(id)
}
