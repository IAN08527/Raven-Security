use raven_lib::db::postgres as pg;

#[tokio::test]
async fn cloud_supabase_storage_baseline() {
    dotenvy::dotenv().ok();
    // Require the real cloud DSN so we never silently pass against a localhost stub.
    let dsn = std::env::var("RAVEN_PG_DSN")
        .expect("RAVEN_PG_DSN must be set (cloud Supabase pooler)");
    assert!(
        dsn.contains("supabase.co"),
        "RAVEN_PG_DSN should point at cloud Supabase, got: {dsn}"
    );

    // Uses the exact same builder the running app uses.
    let pool = pg::create_pool().expect("create_pool");

    // The sandbox resolver is intermittently flaky; retry the DB round-trip so a
    // transient DNS blip does not mask a working storage layer.
    let mut last_err = String::new();
    for attempt in 1..=12 {
        match try_roundtrip(&pool).await {
            Ok(()) => return,
            Err(e) => {
                last_err = e;
                println!("[retry {attempt}/12] {last_err}");
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
    }
    panic!("cloud Supabase storage baseline failed after retries: {last_err}");
}

async fn try_roundtrip(pool: &sqlx::PgPool) -> Result<(), String> {
    // 1) Liveness probe -> drives the "supabase" row in the health gate.
    if !pg::pg_health(pool).await {
        return Err("pg_health should be UP".into());
    }

    // 2) Schema from Session 1a is readable.
    let present = pg::schema_present(pool)
        .await
        .map_err(|e| e.to_string())?;
    if !present {
        return Err("Raven core schema must be present in cloud Supabase".into());
    }

    // 3) Representative reads through the storage layer.
    let sf = pg::count_source_files(pool).await.map_err(|e| e.to_string())?;
    let cases = pg::list_cases(pool).await.map_err(|e| e.to_string())?;
    println!("supabase=up source_files={sf} cases={}", cases.len());

    // 4) Round-trip write+read to prove the ingest storage path works end-to-end.
    let case_id = match cases.first() {
        Some(c) => c.id.clone(),
        None => {
            let id: String = sqlx::query_scalar(
                "INSERT INTO cases (id, case_code, title) \
                 VALUES (gen_random_uuid(), 'OP-RAVEN-PROBE', 'storage baseline probe') \
                 ON CONFLICT (case_code) DO UPDATE SET title=EXCLUDED.title \
                 RETURNING id::text",
            )
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?;
            id
        }
    };

    let file_id = pg::insert_source_file(
        pool,
        &case_id,
        "probe.txt",
        "text/plain",
        42,
        &"0".repeat(64),
        "probe/probe.txt",
        "MANUAL",
    )
    .await
    .map_err(|e| e.to_string())?;
    if file_id.is_empty() {
        return Err("insert_source_file should return an id".into());
    }

    let after = pg::count_source_files(pool).await.map_err(|e| e.to_string())?;
    if after < 1 {
        return Err("source_files should have at least the probe row".into());
    }
    println!("PASS: Rust sqlx storage layer reads/writes cloud Supabase");
    Ok(())
}
