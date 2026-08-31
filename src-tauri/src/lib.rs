pub mod commands;

use raven_core::AppState;

#[tauri::command]
fn ping() -> String {
    "raven-ok".into()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();

    let pg = raven_core::db::postgres::create_pool().expect("failed to build Supabase pg pool");

    let neo = {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio rt");
        let uri = std::env::var("NEO4J_URI").unwrap_or_else(|_| "127.0.0.1:7687".into());
        let user = std::env::var("NEO4J_USER").unwrap_or_else(|_| "neo4j".into());
        let pass = std::env::var("NEO4J_PASS").unwrap_or_else(|_| "raven-demo-pw".into());
        rt.block_on(neo4rs::Graph::new(uri, user, pass)).ok()
    };

    let storage = raven_core::db::storage::SupabaseStorage::from_env();
    let state = AppState {
        pg,
        neo,
        http: reqwest::Client::new(),
        storage,
        ledger_base: std::env::var("LEDGER_BASE").unwrap_or_else(|_| "http://127.0.0.1:8801".into()),
        badge: std::env::var("RAVEN_BADGE").unwrap_or_else(|_| "MH-1188".into()),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            ping,
            commands::ledger::health_check,
            commands::ingest::ingest_file,
            commands::ingest::get_ingest_status,
            commands::graph::get_ego_graph,
            commands::graph::get_macro_graph,
            commands::graph::list_entities,
            commands::graph::get_entity_details,
            commands::audit::get_edge_evidence,
            commands::audit::verify_evidence,
            commands::audit::review_insight,
            commands::cctv::get_routine,
            commands::cctv::start_tracking,
            commands::cctv::lock_on_target,
            commands::cctv::confirm_sighting,
            commands::cctv::stop_tracking,
            commands::graph::rebuild_graph,
            commands::audit::get_audit_trail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Raven");
}
