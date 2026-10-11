mod database;
mod documents;
mod mcp;
mod tunnel;
mod activity;

use database::{Database, DocumentRow, SearchResult};
use documents::ImportResult;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{Manager, State};
use tunnel::TunnelManager;
use activity::{ActivityEvent, ActivityLog};

#[derive(Clone)]
struct AppState {
    db: Database,
    tunnel: TunnelManager,
    activity: ActivityLog,
}

#[derive(Serialize)]
struct AppStatus {
    mcp_url: String,
    document_count: i64,
    chunk_count: i64,
}

#[tauri::command]
fn get_status(state: State<'_, AppState>) -> Result<AppStatus, String> {
    let (document_count, chunk_count) = state.db.counts().map_err(|e| e.to_string())?;
    Ok(AppStatus {
        mcp_url: "http://127.0.0.1:8765/mcp".into(),
        document_count,
        chunk_count,
    })
}

#[tauri::command]
fn list_documents(state: State<'_, AppState>) -> Result<Vec<DocumentRow>, String> {
    state.db.list_documents().map_err(|e| e.to_string())
}

#[tauri::command]
fn import_pdf(path: String, state: State<'_, AppState>) -> Result<ImportResult, String> {
    documents::import_pdf(&state.db, &PathBuf::from(path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn search_local(query: String, limit: usize, state: State<'_, AppState>) -> Result<Vec<SearchResult>, String> {
    state.db.search(&query, limit.clamp(1, 20)).map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_tunnel(state: State<'_, AppState>) -> Result<String, String> {
    state.tunnel.start("http://127.0.0.1:8765").await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn stop_tunnel(state: State<'_, AppState>) -> Result<(), String> {
    state.tunnel.stop().await.map_err(|e| e.to_string())
}

#[tauri::command]
fn get_activity(
    state: State<'_, AppState>,
) -> Vec<ActivityEvent> {
    state.activity.list()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let db = Database::open(&app_data_dir.join("knowledge.sqlite"))?;
            let activity = ActivityLog::default();
            let state = AppState { db: db.clone(),activity: activity.clone(), tunnel: TunnelManager::default() };
            app.manage(state);

            tauri::async_runtime::spawn(async move {
                if let Err(error) = mcp::serve(db,activity, "127.0.0.1:8765").await {
                    eprintln!("MCP server stopped: {error:#}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            list_documents,
            import_pdf,
            search_local,
            start_tunnel,
            stop_tunnel,
            get_activity
        ])
        .run(tauri::generate_context!())
        .expect("error while running PaperLink");
}
