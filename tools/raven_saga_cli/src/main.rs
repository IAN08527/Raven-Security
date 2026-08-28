//! Headless proof of the Raven ingest saga (architecture.md §6.1).
//!
//! Build & run (GNU toolchain, no MSVC linker required):
//!   cd tools/raven_saga_cli
//!   cargo run -- <file> [case_id] [source]
//!
//! It exercises the REAL storage layer against the cloud Supabase project:
//!   * SHA-256 + magic-byte MIME sniff
//!   * source_files insert (status 'hashing' -> 'stored' -> 'committed')
//!   * Supabase Storage blob upload (compensated on failure)
//!   * ledger anchor (best-effort; continues if the ledger is down)
//!   * Neo4j MERGE of the document node (best-effort)
//!   * audit emit
//! Services that are unreachable degrade gracefully and are reported in the
//! final JSON outcome, so this is a safe end-to-end smoke test in any sandbox.

use raven_core::saga::{run_ingest_saga, Progress};
use sha2::{Digest, Sha256};

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage:");
        eprintln!("  raven_saga_cli <file> [case_id] [source]   run the ingest saga");
        eprintln!("  raven_saga_cli --verify <file_id>          verify a prior ingest (DB row + blob SHA)");
        std::process::exit(2);
    }

    let state = match raven_core::connect().await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("connect failed: {e}");
            std::process::exit(1);
        }
    };

    if let Some(file_id) = (args[1] == "--verify").then(|| args.get(2).cloned()).flatten() {
        match verify(&state, &file_id).await {
            Ok(()) => std::process::exit(0),
            Err(e) => {
                eprintln!("VERIFY FAILED: {e}");
                std::process::exit(1);
            }
        }
    }

    let path = args[1].clone();
    let case_id = args.get(2).cloned().unwrap_or_else(|| "OP-RAVEN-01".into());
    let source = args.get(3).cloned().unwrap_or_else(|| "MANUAL".into());

    // Make sure the Storage bucket exists (best-effort).
    if let Some(storage) = &state.storage {
        if let Err(e) = storage.ensure_bucket().await {
            eprintln!("warn: ensure_bucket failed: {e}");
        }
    }

    let supabase_up = raven_core::db::postgres::pg_health(&state.pg).await;
    println!(
        "connect: supabase={} neo4j={} storage={}",
        supabase_up,
        state.neo.is_some(),
        state.storage.is_some()
    );
    if !supabase_up {
        eprintln!("FATAL: Supabase is down — cannot run the saga.");
        std::process::exit(1);
    }

    // Make sure the target case exists (test convenience).
    if let Err(e) = raven_core::db::postgres::ensure_case(
        &state.pg,
        &case_id,
        &format!("Auto case {case_id}"),
    )
    .await
    {
        eprintln!("warn: ensure_case failed: {e}");
    }

    println!("ingest start: path={path} case={case_id} source={source}\n");

    let outcome = run_ingest_saga(&state, &path, &case_id, &source, &mut |p: Progress| {
        let note = p.note.map(|n| format!(" ({n})")).unwrap_or_default();
        println!("  [{:>10}] {:>3}%{}", p.stage, p.pct, note);
    })
    .await;

    match outcome {
        Ok(o) => {
            println!("\nSAGA OK:\n{}", serde_json::to_string_pretty(&o).unwrap());
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("\nSAGA FAILED: {e}");
            std::process::exit(1);
        }
    }
}

/// Verify a previously ingested file: confirm the `source_files` row and that
/// the blob in Supabase Storage hashes back to the anchored SHA-256.
async fn verify(state: &raven_core::AppState, file_id: &str) -> Result<(), String> {
    let row: Option<(String, String, i64, String, String, String)> = sqlx::query_as(
        "SELECT filename, mime_type, byte_size, sha256, storage_path, status::text \
         FROM source_files WHERE id = $1::uuid",
    )
    .bind(file_id)
    .persistent(false)
    .fetch_optional(&state.pg)
    .await
    .map_err(|e| e.to_string())?;

    let (filename, mime, size, sha, storage_path, status) = match row {
        Some(r) => r,
        None => return Err(format!("no source_files row for {file_id}")),
    };

    println!("source_files row:");
    println!("  filename      = {filename}");
    println!("  mime_type     = {mime}");
    println!("  byte_size     = {size}");
    println!("  sha256        = {sha}");
    println!("  storage_path  = {storage_path}");
    println!("  status        = {status}");

    let Some(storage) = &state.storage else {
        println!("storage not configured — cannot verify blob.");
        return Ok(());
    };

    let bytes = storage.download(&storage_path).await?;
    let got = {
        let mut h = Sha256::new();
        h.update(&bytes);
        format!("{:x}", h.finalize())
    };
    println!("  blob bytes    = {}", bytes.len());
    println!("  blob sha256   = {got}");
    if got.eq_ignore_ascii_case(&sha) {
        println!("VERIFY OK: stored hash matches downloaded blob.");
        Ok(())
    } else {
        Err("SHA-256 mismatch between DB record and Storage blob".into())
    }
}

