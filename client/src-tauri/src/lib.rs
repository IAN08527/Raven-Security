//! Tauri v2 Rust core: local file handling, upload, session, cache.
//! The WebView never sees credentials; the session token stays here.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running raven desktop application");
}
