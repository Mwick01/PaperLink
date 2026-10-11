mod database;
mod documents;
mod mcp;
mod tunnel;
mod activity;
mod embeddings;
mod hybrid_search;
mod chunking;

use activity::{
    ActivityEvent,
    ActivityLog,
};

use database::{
    Database,
    DocumentRow,
    SearchResult,
};

use documents::ImportResult;
use embeddings::EmbeddingEngine;

use serde::Serialize;
use std::path::PathBuf;

use tauri::{
    Manager,
    State,
};

use tunnel::TunnelManager;

#[derive(Clone)]
struct AppState {
    db: Database,
    tunnel: TunnelManager,
    activity: ActivityLog,
    embeddings: EmbeddingEngine,
}

#[derive(Serialize)]
struct AppStatus {
    mcp_url: String,
    document_count: i64,
    chunk_count: i64,
}

#[tauri::command]
fn get_status(
    state: State<'_, AppState>,
) -> Result<AppStatus, String> {
    let (document_count, chunk_count) =
        state.db
            .counts()
            .map_err(|e| e.to_string())?;

    Ok(AppStatus {
        mcp_url:
            "http://127.0.0.1:8765/mcp".into(),
        document_count,
        chunk_count,
    })
}

#[tauri::command]
fn list_documents(
    state: State<'_, AppState>,
) -> Result<Vec<DocumentRow>, String> {
    state.db
        .list_documents()
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn import_pdf(
    path: String,
    state: State<'_, AppState>,
) -> Result<ImportResult, String> {
    let db = state.db.clone();
    let embeddings = state.embeddings.clone();

    tauri::async_runtime::spawn_blocking(move || {
        //
        // 1. Extract + chunk + save PDF
        //
        let result = documents::import_pdf(
            &db,
            &PathBuf::from(path),
        )
        .map_err(|e| e.to_string())?;

        //
        // 2. Find chunks that do not yet
        //    have semantic embeddings
        //
        let missing = db
            .chunks_missing_embeddings(
                embeddings.model_name()
            )
            .map_err(|e| e.to_string())?;

        if missing.is_empty() {
            return Ok(result);
        }

        println!(
            "Generating {} embeddings automatically",
            missing.len()
        );

        //
        // 3. Embed locally
        //
        let texts = missing
            .iter()
            .map(|(_, text)| text.clone())
            .collect::<Vec<_>>();

        let vectors = embeddings
            .embed_many(texts)
            .map_err(|e| e.to_string())?;

        //
        // 4. Save vectors into SQLite
        //
        for ((chunk_id, _), vector)
            in missing.into_iter().zip(vectors)
        {
            db.save_embedding(
                chunk_id,
                embeddings.model_name(),
                &vector,
            )
            .map_err(|e| e.to_string())?;
        }

        println!("Semantic index ready");

        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn search_local(
    query: String,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<Vec<SearchResult>, String> {
    state.db
        .search(
            &query,
            limit.clamp(1, 20),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_tunnel(
    state: State<'_, AppState>,
) -> Result<String, String> {
    state.tunnel
        .start(
            "http://127.0.0.1:8765"
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn stop_tunnel(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.tunnel
        .stop()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_activity(
    state: State<'_, AppState>,
) -> Vec<ActivityEvent> {
    state.activity.list()
}

#[tauri::command]
async fn search_hybrid(
    query: String,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<Vec<SearchResult>, String> {
    let db = state.db.clone();
    let embeddings = state.embeddings.clone();

    tauri::async_runtime::spawn_blocking(move || {
        hybrid_search::hybrid_search(
            &db,
            &embeddings,
            &query,
            limit.clamp(1, 20),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn search_semantic(
    query: String,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<Vec<SearchResult>, String> {
    let db = state.db.clone();
    let embeddings = state.embeddings.clone();

    tauri::async_runtime::spawn_blocking(move || {
        hybrid_search::semantic_search(
            &db,
            &embeddings,
            &query,
            limit.clamp(1, 20),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn build_embeddings(
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let db = state.db.clone();
    let engine =
        state.embeddings.clone();

    tauri::async_runtime::spawn_blocking(
        move || {
            let missing = db
                .chunks_missing_embeddings(
                    engine.model_name()
                )
                .map_err(|e| e.to_string())?;

            if missing.is_empty() {
                return Ok(0);
            }

            let texts: Vec<String> =
                missing
                    .iter()
                    .map(
                        |(_, text)|
                            text.clone()
                    )
                    .collect();

            let vectors = engine
                .embed_many(texts)
                .map_err(|e| e.to_string())?;

            let count = vectors.len();

            for ((chunk_id, _), vector)
                in missing
                    .into_iter()
                    .zip(vectors)
            {
                db.save_embedding(
                    chunk_id,
                    engine.model_name(),
                    &vector,
                )
                .map_err(
                    |e| e.to_string()
                )?;
            }

            Ok(count)
        },
    )
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(
    mobile,
    tauri::mobile_entry_point
)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_dialog::init()
        )
        .setup(|app| {
            let app_data_dir =
                app.path()
                    .app_data_dir()?;

            let model_cache =
                app_data_dir.join("models");

            let db = Database::open(
                &app_data_dir.join(
                    "knowledge.sqlite"
                ),
            )?;

            let activity =
                ActivityLog::default();

            let embeddings =
                EmbeddingEngine::new(
                    model_cache
                );
            let embeddings_for_mcp = embeddings.clone();

            let state = AppState {
                db: db.clone(),
                tunnel:
                    TunnelManager::default(),
                activity:
                    activity.clone(),
                embeddings:
                    embeddings.clone(),
            };

            app.manage(state);

            tauri::async_runtime::spawn(
                async move {
                    if let Err(error) =
                        mcp::serve(
                            db,
                            activity,
                            embeddings_for_mcp,
                            "127.0.0.1:8765",
                        )
                        .await
                    {
                        eprintln!(
                            "MCP server stopped: \
                             {error:#}"
                        );
                    }
                },
            );

            Ok(())
        })
        .invoke_handler(
            tauri::generate_handler![
                get_status,
                list_documents,
                import_pdf,
                search_local,
                search_semantic,
                search_hybrid,
                start_tunnel,
                stop_tunnel,
                get_activity,
                build_embeddings
            ],
        )
        .run(
            tauri::generate_context!()
        )
        .expect(
            "error while running PaperLink"
        );
}   


