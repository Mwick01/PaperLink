use crate::database::Database;
use crate::activity::ActivityLog;
use rmcp::{handler::server::wrapper::Parameters, schemars, tool, tool_router};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager,
    StreamableHttpServerConfig,
    StreamableHttpService,
};
use serde::Deserialize;

#[derive(Clone)]
pub struct KnowledgeMcp {
    db: Database,
    activity: ActivityLog,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct SearchParams {
    /// Search words or phrase to look up in the user's local documents.
    query: String,
    /// Maximum number of matching chunks to return. Defaults to 5 and is capped at 20.
    limit: Option<usize>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct ReadDocumentParams {
    /// Local document identifier returned by search_documents or list_documents.
    document_id: i64,
    /// Maximum chunks to read from the start of the document. Defaults to 20 and is capped at 100.
    limit: Option<usize>,
}

#[tool_router(server_handler)]
impl KnowledgeMcp {
    pub fn new(db: Database,activity: ActivityLog) -> Self { Self { db, activity } }

    #[tool(description = "Search the user's locally indexed documents. Returns relevant document chunks with local document IDs and filenames.")]
    fn search_documents(
        &self,
        Parameters(params): Parameters<SearchParams>,
    ) -> String {
        let limit = params.limit.unwrap_or(5).clamp(1, 20);

        match self.db.search(&params.query, limit) {
            Ok(results) => {
                self.activity.record(
                    "search_documents",
                    format!("query: \"{}\"", params.query),
                    format!("returned {} chunks", results.len()),
                );

                serde_json::to_string_pretty(&results)
                    .unwrap_or_else(|_| "[]".into())
            }

            Err(error) => {
                self.activity.record(
                    "search_documents",
                    format!("query: \"{}\"", params.query),
                    format!("error: {error}"),
                );

                format!("Search failed: {error}")
            }
        }
    }

    #[tool(description = "List all documents currently indexed in the user's local knowledge database.")]
    fn list_documents(&self) -> String {
        match self.db.list_documents() {
            Ok(documents) => {
                let count = documents.len();

                self.activity.record(
                    "list_documents",
                    "",
                    format!(
                        "returned {} document{}",
                        count,
                        if count == 1 { "" } else { "s" }
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

    #[tool(description = "Read chunks from a locally indexed document by its document ID.")]
    fn read_document(
        &self,
        Parameters(params): Parameters<ReadDocumentParams>,
    ) -> String {
        let limit = params.limit.unwrap_or(20).clamp(1, 100);

        match self.db.read_document_chunks(params.document_id, limit) {
            Ok(chunks) => {
                self.activity.record(
                    "read_document",
                    format!("document_id: {}", params.document_id),
                    format!("returned {} chunks", chunks.len()),
                );

                serde_json::to_string_pretty(&chunks)
                    .unwrap_or_else(|_| "[]".into())
            }

            Err(error) => {
                self.activity.record(
                    "read_document",
                    format!("document_id: {}", params.document_id),
                    format!("error: {error}"),
                );

                format!("Read failed: {error}")
            }
        }
    }
}

pub async fn serve(db: Database,activity: ActivityLog, bind_address: &str) -> anyhow::Result<()> {
    let shared_db = db.clone();
    let shared_activity = activity.clone();
    let service = StreamableHttpService::new(
        move || {
            Ok(KnowledgeMcp::new(
                shared_db.clone(),
                shared_activity.clone(),
            ))
        },
        LocalSessionManager::default().into(),
        StreamableHttpServerConfig::default()
            .with_legacy_session_mode(false)
            .with_json_response(true),
    );

    let router = axum::Router::new().nest_service("/mcp", service);
    let listener = tokio::net::TcpListener::bind(bind_address).await?;
    axum::serve(listener, router).await?;
    Ok(())
}
