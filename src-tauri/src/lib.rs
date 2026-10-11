mod database;
mod documents;
mod mcp;
mod tunnel;
mod activity;
mod embeddings;
mod hybrid_search;
mod chunking;
mod auth;

use activity::{
    ActivityEvent,
    ActivityLog,
};
use auth::AuthState;
use database::{
    CollectionRow,
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
    auth: AuthState,
}

#[derive(Serialize)]
struct AppStatus {
    mcp_url: String,
    document_count: i64,
    chunk_count: i64,
    compatibility_mode: bool,
}

#[derive(Serialize)]
struct TunnelConnection {
    url: String,
    token: String,
}

#[derive(Serialize)]
struct FolderImportResult {
    discovered: usize,
    imported: usize,
    failed: usize,
    embeddings_added: usize,
    errors: Vec<String>,
}

#[tauri::command]
fn list_collections(
    state: State<'_, AppState>,
) -> Result<Vec<CollectionRow>, String> {
    state
        .db
        .list_collections()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn create_collection(
    name: String,
    parent_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    if name.trim().is_empty() {
        return Err("Folder name cannot be empty".into());
    }

    state
        .db
        .create_collection(
            &name,
            parent_id,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn move_document(
    document_id: i64,
    collection_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .db
        .move_document_to_collection(
            document_id,
            collection_id,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_collection(
    collection_id: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .db
        .delete_collection(collection_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn import_folder(
    path: String,
    state: State<'_, AppState>,
) -> Result<FolderImportResult, String> {
    let db = state.db.clone();
    let embeddings = state.embeddings.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let folder = PathBuf::from(path);

        let pdfs =
            documents::find_pdfs(&folder)
                .map_err(|e| e.to_string())?;

        let discovered = pdfs.len();
        let mut imported = 0;
        let mut errors = Vec::new();

        for pdf in pdfs {
            match documents::import_pdf(
                &db,
                &pdf,
            ) {
                Ok(_) => {
                    imported += 1;
                }

                Err(error) => {
                    errors.push(format!(
                        "{}: {}",
                        pdf.display(),
                        error
                    ));
                }
            }
        }

        let embeddings_added =
            build_missing_embeddings(
                &db,
                &embeddings,
            )?;

        Ok(FolderImportResult {
            discovered,
            imported,
            failed: errors.len(),
            embeddings_added,
            errors,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn reindex_document(
    document_id: i64,
    state: State<'_, AppState>,
) -> Result<ImportResult, String> {
    let db = state.db.clone();
    let embeddings = state.embeddings.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let path = db
            .document_path(document_id)
            .map_err(|e| e.to_string())?;

        if !path.exists() {
            return Err(format!(
                "Original PDF no longer exists: {}",
                path.display()
            ));
        }

        let result =
            documents::import_pdf(
                &db,
                &path,
            )
            .map_err(|e| e.to_string())?;

        build_missing_embeddings(
            &db,
            &embeddings,
        )?;

        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn delete_document(
    document_id: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .db
        .delete_document(document_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_status(
    state: State<'_, AppState>,
) -> Result<AppStatus, String> {
    let (document_count, chunk_count) =
        state
            .db
            .counts()
            .map_err(|e| e.to_string())?;

    Ok(AppStatus {
        mcp_url:
            "http://127.0.0.1:8765/mcp".into(),
        document_count,
        chunk_count,
        compatibility_mode:
            state.auth.compatibility_mode(),
    })
}

#[tauri::command]
fn list_documents(
    state: State<'_, AppState>,
) -> Result<Vec<DocumentRow>, String> {
    state
        .db
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
        let result =
            documents::import_pdf(
                &db,
                &PathBuf::from(path),
            )
            .map_err(|e| e.to_string())?;

        build_missing_embeddings(
            &db,
            &embeddings,
        )?;

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
    state
        .db
        .search(
            &query,
            limit.clamp(1, 20),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_tunnel(
    state: State<'_, AppState>,
) -> Result<TunnelConnection, String> {
    // Every new tunnel starts in secure bearer-token mode.
    state
        .auth
        .set_compatibility_mode(false)
        .map_err(|e| e.to_string())?;

    let token = state
        .auth
        .generate_token()
        .map_err(|e| e.to_string())?;

    match state
        .tunnel
        .start(
            "http://127.0.0.1:8765"
        )
        .await
    {
        Ok(url) => {
            Ok(TunnelConnection {
                url,
                token,
            })
        }

        Err(error) => {
            state.auth.clear();
            Err(error.to_string())
        }
    }
}

#[tauri::command]
async fn stop_tunnel(
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .tunnel
        .stop()
        .await
        .map_err(|e| e.to_string())?;

    // clear() also disables compatibility mode.
    state.auth.clear();

    Ok(())
}

#[tauri::command]
fn set_compatibility_mode(
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if enabled && !state.auth.enabled() {
        return Err(
            "Start the temporary tunnel before enabling Claude compatibility mode."
                .into(),
        );
    }

    state
        .auth
        .set_compatibility_mode(enabled)
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

fn build_missing_embeddings(
    db: &Database,
    engine: &EmbeddingEngine,
) -> Result<usize, String> {
    let missing = db
        .chunks_missing_embeddings(
            engine.model_name()
        )
        .map_err(|e| e.to_string())?;

    if missing.is_empty() {
        return Ok(0);
    }

    let texts = missing
        .iter()
        .map(|(_, text)| text.clone())
        .collect::<Vec<_>>();

    println!(
        "Generating embeddings for {} chunks...",
        texts.len()
    );

    let vectors = engine
        .embed_many(texts)
        .map_err(|e| e.to_string())?;

    let count = vectors.len();

    for ((chunk_id, _), vector)
        in missing.into_iter().zip(vectors)
    {
        db.save_embedding(
            chunk_id,
            engine.model_name(),
            &vector,
        )
        .map_err(|e| e.to_string())?;
    }

    println!("Generated {count} embeddings");

    Ok(count)
}

#[tauri::command]
async fn build_embeddings(
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let db = state.db.clone();
    let engine = state.embeddings.clone();

    tauri::async_runtime::spawn_blocking(move || {
        build_missing_embeddings(
            &db,
            &engine,
        )
    })
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

            let embeddings_for_mcp =
                embeddings.clone();

            let auth =
                AuthState::default();

            let auth_for_mcp =
                auth.clone();

            let state = AppState {
                db: db.clone(),
                tunnel:
                    TunnelManager::default(),
                activity:
                    activity.clone(),
                embeddings:
                    embeddings.clone(),
                auth:
                    auth.clone(),
            };

            app.manage(state);

            tauri::async_runtime::spawn(
                async move {
                    if let Err(error) =
                        mcp::serve(
                            db,
                            activity,
                            auth_for_mcp,
                            embeddings_for_mcp,
                            "127.0.0.1:8765",
                        )
                        .await
                    {
                        eprintln!(
                            "MCP server stopped: {error:#}"
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
                list_collections,
                create_collection,
                move_document,
                delete_collection,
                import_pdf,
                import_folder,
                reindex_document,
                delete_document,
                search_local,
                search_semantic,
                search_hybrid,
                start_tunnel,
                stop_tunnel,
                set_compatibility_mode,
                get_activity,
                build_embeddings
            ]
        )
        .run(
            tauri::generate_context!()
        )
        .expect(
            "error while running PaperLink"
        );
}
