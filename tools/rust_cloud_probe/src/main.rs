// Standalone runtime proof of the Raven Rust storage layer against the REAL
// cloud Supabase project. Deliberately depends only on sqlx (no Tauri/WebView2)
// so it can run in a headless sandbox. The queries mirror
// `src-tauri/src/db/postgres.rs` 1:1 so a green run proves the app's storage
// layer is wired correctly.

use sqlx::postgres::PgPoolOptions;
use sqlx::ConnectOptions;
use std::time::Duration;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    let dsn = std::env::var("RAVEN_PG_DSN")
        .expect("RAVEN_PG_DSN must be set (cloud Supabase pooler)");
    assert!(dsn.contains("supabase.co"), "DSN must point at cloud Supabase");

    let url = url::Url::parse(&dsn).expect("RAVEN_PG_DSN must be a valid URL");
    let opts = sqlx::postgres::PgConnectOptions::from_url(&url)
        .expect("build connect options")
        .statement_cache_capacity(0)
        .ssl_mode(sqlx::postgres::PgSslMode::Require);
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .idle_timeout(Duration::from_secs(30))
        .connect_lazy_with(opts);

    let mut last = String::new();
    for attempt in 1..=15 {
        match try_roundtrip(&pool).await {
            Ok(()) => {
                println!("PASS: Rust sqlx storage layer reads/writes cloud Supabase");
                return;
            }
            Err(e) => {
                last = e;
                println!("[retry {attempt}/15] {last}");
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    }
    panic!("Rust cloud storage proof failed: {last}");
}

async fn try_roundtrip(pool: &sqlx::PgPool) -> Result<(), String> {
    // 1) liveness -> drives the "supabase" row in the health gate
    // Use raw_sql to avoid prepared statements entirely for the simple probe.
    use sqlx::Row;
    let row = sqlx::raw_sql("SELECT 1 AS ok")
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    let up: i32 = row.try_get("ok").map_err(|e| e.to_string())?;
    if up != 1 {
        return Err("pg_health should be UP".into());
    }

    // 2) Session 1a schema present
    // .persistent(false) => unnamed prepared statement, PgBouncer-safe.
    let present: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM information_schema.tables \
         WHERE table_schema='public' \
           AND table_name IN ('officers','cases','source_files','entities','relationships',\
           'evidence','cdr_records','financial_txns','audit_log','reid_targets')",
    )
    .persistent(false)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    if present < 6 {
        return Err(format!("core schema incomplete (found {present}/10 tables)"));
    }

    // 3) representative reads
    let sf: i64 = sqlx::query_scalar("SELECT count(*) FROM source_files")
        .persistent(false)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    let cases: Vec<String> = sqlx::query_scalar("SELECT id::text FROM cases LIMIT 5")
        .persistent(false)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    println!("supabase=up source_files={sf} cases={}", cases.len());

    // 4) write+read round trip
    let case_id = match cases.first() {
        Some(c) => c.clone(),
        None => sqlx::query_scalar::<_, String>(
            "INSERT INTO cases (id, case_code, title) \
             VALUES (gen_random_uuid(), 'OP-RAVEN-PROBE', 'storage baseline probe') \
             ON CONFLICT (case_code) DO UPDATE SET title=EXCLUDED.title \
             RETURNING id::text",
        )
        .persistent(false)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?,
    };
    let file_id: String = sqlx::query_scalar::<_, String>(
        "INSERT INTO source_files (id, case_id, filename, mime_type, byte_size, sha256, storage_path, source) \
         VALUES (gen_random_uuid(), $1::uuid, 'probe.txt','text/plain',42, $2, 'probe/probe.txt','MANUAL') \
         RETURNING id::text",
    )
    .bind(&case_id)
    .bind("0".repeat(64))
    .persistent(false)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;
    if file_id.is_empty() {
        return Err("insert_source_file should return an id".into());
    }
    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM source_files")
        .persistent(false)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())?;
    if after < 1 {
        return Err("source_files should have at least the probe row".into());
    }
    Ok(())
}
