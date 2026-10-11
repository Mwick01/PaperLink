use crate::{
    activity::ActivityLog,
    auth::AuthState,
    database::{CollectionRow, Database},
    embeddings::EmbeddingEngine,
    hybrid_search,
};

use axum::{
    extract::State,
    http::{
        header::AUTHORIZATION,
        HeaderMap,
        Request,
        StatusCode,
    },
    middleware::{self, Next},
    response::Response,
    Router,
};

use rmcp::{
    handler::server::wrapper::Parameters,
    schemars,
    tool,
    tool_router,
};

use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager,
    StreamableHttpServerConfig,
    StreamableHttpService,
};

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone)]
pub struct KnowledgeMcp {
    db: Database,
    activity: ActivityLog,
    embeddings: EmbeddingEngine,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct SearchParams {
    /// Search words or phrase to look up in the user's local documents.
    query: String,

    /// Maximum number of matching chunks to return. Defaults to 5 and is capped at 20.
    limit: Option<usize>,

    /// Optional PaperLink collection/folder ID. When supplied, search is limited
    /// to documents in that collection and its subfolders.
    collection_id: Option<i64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct ReadDocumentParams {
    /// Local document identifier returned by search_documents or list_documents.
    document_id: i64,

    /// Maximum chunks to read from the start of the document.
    /// Defaults to 20 and is capped at 100.
    limit: Option<usize>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct ListCollectionDocumentsParams {
    /// PaperLink collection/folder ID returned by list_collections.
    collection_id: i64,

    /// Include documents stored in nested subfolders. Defaults to true.
    include_subfolders: Option<bool>,
}

#[derive(Debug, Serialize)]
struct McpCollection {
    id: i64,
    name: String,
    parent_id: Option<i64>,
    path: String,
    direct_document_count: i64,
}

#[derive(Debug, Serialize)]
struct McpDocument {
    id: i64,
    filename: String,
    chunk_count: i64,
    collection_id: Option<i64>,
    collection: Option<String>,
    collection_path: Option<String>,
}

fn collection_lookup(
    collections: &[CollectionRow],
) -> HashMap<i64, (String, Option<i64>)> {
    collections
        .iter()
        .map(|collection| {
            (
                collection.id,
                (
                    collection.name.clone(),
                    collection.parent_id,
                ),
            )
        })
        .collect()
}

fn collection_path(
    collection_id: i64,
    lookup: &HashMap<i64, (String, Option<i64>)>,
) -> String {
    let mut parts = Vec::new();
    let mut current = Some(collection_id);
    let mut seen = HashSet::new();

    while let Some(id) = current {
        if !seen.insert(id) {
            break;
        }

        let Some((name, parent_id)) = lookup.get(&id) else {
            break;
        };

        parts.push(name.clone());
        current = *parent_id;
    }

    parts.reverse();
    parts.join("/")
}

fn collection_tree_ids(
    collections: &[CollectionRow],
    root_id: i64,
) -> HashSet<i64> {
    let mut ids = HashSet::from([root_id]);
    let mut changed = true;

    while changed {
        changed = false;

        for collection in collections {
            if let Some(parent_id) = collection.parent_id {
                if ids.contains(&parent_id) && !ids.contains(&collection.id) {
                    ids.insert(collection.id);
                    changed = true;
                }
            }
        }
    }

    ids
}

fn document_views(
    db: &Database,
) -> anyhow::Result<Vec<McpDocument>> {
    let collections = db.list_collections()?;
    let lookup = collection_lookup(&collections);
    let documents = db.list_documents()?;

    Ok(
        documents
            .into_iter()
            .map(|document| {
                let collection_name = document
                    .collection_id
                    .and_then(|id| {
                        lookup
                            .get(&id)
                            .map(|(name, _)| name.clone())
                    });

                let path = document
                    .collection_id
                    .map(|id| collection_path(id, &lookup));

                McpDocument {
                    id: document.id,
                    filename: document.filename,
                    chunk_count: document.chunk_count,
                    collection_id: document.collection_id,
                    collection: collection_name,
                    collection_path: path,
                }
            })
            .collect(),
    )
}

#[tool_router(server_handler)]
impl KnowledgeMcp {
    pub fn new(
        db: Database,
        activity: ActivityLog,
        embeddings: EmbeddingEngine,
    ) -> Self {
        Self {
            db,
            activity,
            embeddings,
        }
    }

    #[tool(
        description = "List PaperLink collections/folders, including parent relationships and full folder paths. Use this to understand how the user's local document library is organized."
    )]
    fn list_collections(&self) -> String {
        match self.db.list_collections() {
            Ok(collections) => {
                let lookup = collection_lookup(&collections);

                let result: Vec<McpCollection> = collections
                    .into_iter()
                    .map(|collection| McpCollection {
                        id: collection.id,
                        name: collection.name,
                        parent_id: collection.parent_id,
                        path: collection_path(
                            collection.id,
                            &lookup,
                        ),
                        direct_document_count:
                            collection.document_count,
                    })
                    .collect();

                self.activity.record(
                    "list_collections",
                    "",
                    format!(
                        "returned {} collection{}",
                        result.len(),
                        if result.len() == 1 { "" } else { "s" },
                    ),
                );

                serde_json::to_string_pretty(&result)
                    .unwrap_or_else(|_| "[]".into())
            }

            Err(error) => {
                self.activity.record(
                    "list_collections",
                    "",
                    format!("error: {error}"),
                );

                format!("List collections failed: {error}")
            }
        }
    }

    #[tool(
        description = "List all documents currently indexed in PaperLink. Each document includes its collection/folder ID, collection name, and full collection path when filed."
    )]
    fn list_documents(&self) -> String {
        match document_views(&self.db) {
            Ok(documents) => {
                let count = documents.len();

                self.activity.record(
                    "list_documents",
                    "",
                    format!(
                        "returned {} document{}",
                        count,
                        if count == 1 { "" } else { "s" },
                    ),
                );

                serde_json::to_string_pretty(&documents)
                    .unwrap_or_else(|_| "[]".into())
            }

            Err(error) => {
                self.activity.record(
                    "list_documents",
                    "",
                    format!("error: {error}"),
                );

                format!("List failed: {error}")
            }
        }
    }

    #[tool(
        description = "List documents inside a specific PaperLink collection/folder. By default this also includes documents in nested subfolders."
    )]
    fn list_collection_documents(
        &self,
        Parameters(params): Parameters<ListCollectionDocumentsParams>,
    ) -> String {
        let include_subfolders =
            params.include_subfolders.unwrap_or(true);

        let collections = match self.db.list_collections() {
            Ok(collections) => collections,
            Err(error) => {
                self.activity.record(
                    "list_collection_documents",
                    format!(
                        "collection_id: {}",
                        params.collection_id,
                    ),
                    format!("error: {error}"),
                );

                return format!(
                    "Could not load collections: {error}"
                );
            }
        };

        if !collections
            .iter()
            .any(|collection| {
                collection.id == params.collection_id
            })
        {
            return format!(
                "Collection {} does not exist.",
                params.collection_id,
            );
        }

        let allowed_collection_ids =
            if include_subfolders {
                collection_tree_ids(
                    &collections,
                    params.collection_id,
                )
            } else {
                HashSet::from([params.collection_id])
            };

        match document_views(&self.db) {
            Ok(documents) => {
                let result: Vec<McpDocument> = documents
                    .into_iter()
                    .filter(|document| {
                        document
                            .collection_id
                            .map(|id| {
                                allowed_collection_ids
                                    .contains(&id)
                            })
                            .unwrap_or(false)
                    })
                    .collect();

                self.activity.record(
                    "list_collection_documents",
                    format!(
                        "collection_id: {}, include_subfolders: {}",
                        params.collection_id,
                        include_subfolders,
                    ),
                    format!(
                        "returned {} document{}",
                        result.len(),
                        if result.len() == 1 { "" } else { "s" },
                    ),
                );

                serde_json::to_string_pretty(&result)
                    .unwrap_or_else(|_| "[]".into())
            }

            Err(error) => {
                self.activity.record(
                    "list_collection_documents",
                    format!(
                        "collection_id: {}",
                        params.collection_id,
                    ),
                    format!("error: {error}"),
                );

                format!(
                    "Could not list collection documents: {error}"
                )
            }
        }
    }

    #[tool(
        description = "Search the user's locally indexed documents using hybrid keyword and semantic retrieval. Optionally limit the search to a PaperLink collection/folder and its subfolders."
    )]
    fn search_documents(
        &self,
        Parameters(params): Parameters<SearchParams>,
    ) -> String {
        let limit = params.limit.unwrap_or(5).clamp(1, 20);

        let candidate_limit =
            if params.collection_id.is_some() {
                200
            } else {
                limit
            };

        let mut results =
            match hybrid_search::hybrid_search(
                &self.db,
                &self.embeddings,
                &params.query,
                candidate_limit,
            ) {
                Ok(results) => results,
                Err(error) => {
                    self.activity.record(
                        "search_documents",
                        format!(
                            "query: \"{}\"",
                            params.query,
                        ),
                        format!("error: {error}"),
                    );

                    return format!(
                        "Search failed: {error}"
                    );
                }
            };

        if let Some(collection_id) =
            params.collection_id
        {
            let collections =
                match self.db.list_collections() {
                    Ok(collections) => collections,
                    Err(error) => {
                        return format!(
                            "Could not load collections: {error}"
                        );
                    }
                };

            if !collections
                .iter()
                .any(|collection| {
                    collection.id == collection_id
                })
            {
                return format!(
                    "Collection {collection_id} does not exist."
                );
            }

            let allowed_collection_ids =
                collection_tree_ids(
                    &collections,
                    collection_id,
                );

            let documents =
                match self.db.list_documents() {
                    Ok(documents) => documents,
                    Err(error) => {
                        return format!(
                            "Could not load documents: {error}"
                        );
                    }
                };

            let allowed_document_ids:
                HashSet<i64> = documents
                .into_iter()
                .filter_map(|document| {
                    document
                        .collection_id
                        .filter(|id| {
                            allowed_collection_ids
                                .contains(id)
                        })
                        .map(|_| document.id)
                })
                .collect();

            results.retain(|result| {
                allowed_document_ids
                    .contains(&result.document_id)
            });

            results.truncate(limit);
        } else {
            results.truncate(limit);
        }

        self.activity.record(
            "search_documents",
            match params.collection_id {
                Some(collection_id) => format!(
                    "query: \"{}\", collection_id: {}",
                    params.query,
                    collection_id,
                ),
                None => format!(
                    "query: \"{}\"",
                    params.query,
                ),
            },
            format!(
                "returned {} chunks",
                results.len(),
            ),
        );

        serde_json::to_string_pretty(&results)
            .unwrap_or_else(|_| "[]".into())
    }

    #[tool(
        description = "Read chunks from a locally indexed document by its document ID."
    )]
    fn read_document(
        &self,
        Parameters(params): Parameters<ReadDocumentParams>,
    ) -> String {
        let limit =
            params.limit.unwrap_or(20).clamp(1, 100);

        match self
            .db
            .read_document_chunks(
                params.document_id,
                limit,
            )
        {
            Ok(chunks) => {
                self.activity.record(
                    "read_document",
                    format!(
                        "document_id: {}",
                        params.document_id,
                    ),
                    format!(
                        "returned {} chunks",
                        chunks.len(),
                    ),
                );

                serde_json::to_string_pretty(&chunks)
                    .unwrap_or_else(|_| "[]".into())
            }

            Err(error) => {
                self.activity.record(
                    "read_document",
                    format!(
                        "document_id: {}",
                        params.document_id,
                    ),
                    format!("error: {error}"),
                );

                format!("Read failed: {error}")
            }
        }
    }
}

fn extract_bearer_token(
    headers: &HeaderMap,
) -> Option<&str> {
    headers
        .get(AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}

async fn auth_middleware(
    State(auth): State<AuthState>,
    headers: HeaderMap,
    request: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    // Local-only mode: no active tunnel token.
    if !auth.enabled() {
        return Ok(next.run(request).await);
    }

    // Claude compatibility mode intentionally allows the temporary tunnel
    // without a bearer header because some connector UIs do not expose
    // arbitrary request headers.
    if auth.compatibility_mode() {
        return Ok(next.run(request).await);
    }

    let token =
        extract_bearer_token(&headers);

    match token {
        Some(token) if auth.validate(token) => {
            Ok(next.run(request).await)
        }

        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

pub async fn serve(
    db: Database,
    activity: ActivityLog,
    auth: AuthState,
    embeddings: EmbeddingEngine,
    bind_address: &str,
) -> anyhow::Result<()> {
    let shared_db = db.clone();
    let shared_activity = activity.clone();
    let shared_embeddings = embeddings.clone();

    let service =
        StreamableHttpService::new(
            move || {
                Ok(KnowledgeMcp::new(
                    shared_db.clone(),
                    shared_activity.clone(),
                    shared_embeddings.clone(),
                ))
            },
            LocalSessionManager::default().into(),
            StreamableHttpServerConfig::default()
                .with_legacy_session_mode(false)
                .with_json_response(true),
        );

    let protected_mcp_router =
        Router::new()
            .nest_service(
                "/mcp",
                service,
            )
            .layer(
                middleware::from_fn_with_state(
                    auth.clone(),
                    auth_middleware,
                ),
            );

    let listener =
        tokio::net::TcpListener::bind(
            bind_address,
        )
        .await?;

    println!(
        "PaperLink MCP listening on http://{bind_address}/mcp"
    );

    axum::serve(
        listener,
        protected_mcp_router,
    )
    .await?;

    Ok(())
}
