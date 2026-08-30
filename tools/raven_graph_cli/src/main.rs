//! Headless proof of the Raven graph engine (Backlog #4, architecture §6.2).
//!
//! Build & run (GNU toolchain, no MSVC linker required):
//!   cd tools/raven_graph_cli
//!   cargo run -- --macro OP-RAVEN-01 [min_weight] [limit]
//!   cargo run -- --ego   <entity_id> [hops] [min_weight]
//!   cargo run -- --edge  <rel_id>
//!   cargo run -- --entities OP-RAVEN-01        (entity picker)
//!   cargo run -- --case OP-RAVEN-01            (resolve case_code -> uuid)
//!
//! It exercises the REAL graph engine against the cloud Supabase (Postgres
//! path) and, when Neo4j is up, the Bolt path with the batched Postgres
//! evidence hydrate. Output is the exact JSON the Tauri commands return.

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage:");
        eprintln!("  raven_graph_cli --macro <case_id> [min_weight] [limit]");
        eprintln!("  raven_graph_cli --ego <entity_id> [hops] [min_weight]");
        eprintln!("  raven_graph_cli --edge <rel_id>");
        eprintln!("  raven_graph_cli --entity <entity_id>");
        eprintln!("  raven_graph_cli --entities <case_id>");
        eprintln!("  raven_graph_cli --case <case_code>");
        std::process::exit(2);
    }

    let state = match raven_core::connect().await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("connect failed: {e}");
            std::process::exit(1);
        }
    };

    let mode = args[1].as_str();
    let num = |i: usize, d: f64| -> f64 {
        args.get(i).and_then(|s| s.parse().ok()).unwrap_or(d)
    };
    let numu = |i: usize, d: u32| -> u32 {
        args.get(i).and_then(|s| s.parse().ok()).unwrap_or(d)
    };

    let res: Result<serde_json::Value, String> = match mode {
        "--case" => {
            let case_id = args.get(2).cloned().unwrap_or_default();
            raven_core::db::postgres::resolve_case_id(&state.pg, &case_id)
                .await
                .map(|id| serde_json::json!({ "case_id": id }))
        }
        "--entities" => {
            let case_id = args.get(2).cloned().unwrap_or_else(|| "OP-RAVEN-01".into());
            raven_core::db::graph::list_entities_pg(&state.pg, &case_id)
                .await
                .map(|nodes| serde_json::json!(nodes))
        }
        "--macro" => {
            let case_id = args.get(2).cloned().unwrap_or_else(|| "OP-RAVEN-01".into());
            let minw = num(3, 5.0);
            let limit = numu(4, 1000);
            raven_core::db::graph::get_macro_graph(&state, &case_id, minw, limit)
                .await
                .and_then(|g| serde_json::to_value(g).map_err(|e| e.to_string()))
        }
        "--ego" => {
            let entity_id = args.get(2).cloned().unwrap_or_default();
            let hops = numu(3, 2);
            let minw = num(4, 5.0);
            raven_core::db::graph::get_ego_graph(&state, &entity_id, hops, minw)
                .await
                .and_then(|g| serde_json::to_value(g).map_err(|e| e.to_string()))
        }
        "--edge" => {
            let rel_id = args.get(2).cloned().unwrap_or_default();
            raven_core::db::graph::edge_evidence_pg(&state.pg, &rel_id)
                .await
                .and_then(|(r, ev, files)| {
                    serde_json::to_value(raven_core::EdgeEvidence {
                        relationship: r,
                        evidence: ev,
                        source_files: files,
                    })
                    .map_err(|e| e.to_string())
                })
        }
        "--entity" => {
            let entity_id = args.get(2).cloned().unwrap_or_default();
            raven_core::db::graph::entity_details_pg(&state.pg, &entity_id)
                .await
                .and_then(|d| serde_json::to_value(d).map_err(|e| e.to_string()))
        }
        other => Err(format!("unknown mode: {other}")),
    };

    match res {
        Ok(v) => {
            println!("{}", serde_json::to_string_pretty(&v).unwrap());
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("FAILED: {e}");
            std::process::exit(1);
        }
    }
}
