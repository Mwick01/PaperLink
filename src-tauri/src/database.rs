use rusqlite::{params, Connection};
use serde::Serialize;
use std::{path::Path, sync::{Arc, Mutex}};

#[derive(Clone)]
pub struct Database {
    connection: Arc<Mutex<Connection>>,
}

#[derive(Debug, Serialize)]
pub struct DocumentRow {
    pub id: i64,
    pub filename: String,
    pub chunk_count: i64,
    pub collection_id: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub document_id: i64,
    pub filename: String,
    pub chunk_id: i64,
    pub chunk_index: i64,
    pub text: String,
    pub score: f64,
}

#[derive(Debug, Serialize)]
pub struct CollectionRow {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub document_count: i64,
}



fn vector_to_blob(vector: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vector.len() * 4);

    for value in vector {
        bytes.extend_from_slice(
            &value.to_le_bytes()
        );
    }

    bytes
}

fn blob_to_vector(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|bytes| {
            f32::from_le_bytes([
                bytes[0],
                bytes[1],
                bytes[2],
                bytes[3],
            ])
        })
        .collect()
}

#[derive(Debug)]
pub struct StoredEmbedding {
    pub chunk_id: i64,
    pub document_id: i64,
    pub filename: String,
    pub chunk_index: i64,
    pub text: String,
    pub vector: Vec<f32>,
}

fn normalize_fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|word| {
            word.trim_matches(|c: char| {
                !c.is_alphanumeric() && c != '_'
            })
        })
        .filter(|word| !word.is_empty())
        .map(|word| {
            let escaped = word.replace('"', "\"\"");
            format!("\"{}\"", escaped)
        })
        .collect::<Vec<_>>()
        .join(" OR ")
}

impl Database {
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        connection.execute_batch(include_str!("../migrations/001_initial.sql"))?;
        connection.execute_batch(include_str!("../migrations/002_collections.sql"))?;
        Ok(Self { connection: Arc::new(Mutex::new(connection)) })
    }
    pub fn document_path(
        &self,
        document_id: i64,
    ) -> anyhow::Result<std::path::PathBuf> {
        let conn = self.connection()?;

        let path: String = conn.query_row(
            "SELECT path FROM documents WHERE id = ?1",
            [document_id],
            |row| row.get(0),
        )?;

        Ok(std::path::PathBuf::from(path))
    }

    pub fn delete_document(
        &self,
        document_id: i64,
    ) -> anyhow::Result<()> {
        let mut conn = self.connection()?;
        let tx = conn.transaction()?;

        // FTS rows are maintained manually.
        tx.execute(
            "DELETE FROM chunks_fts WHERE document_id = ?1",
            [document_id],
        )?;

        // Delete vectors before deleting chunks.
        tx.execute(
            "
            DELETE FROM chunk_embeddings
            WHERE chunk_id IN (
                SELECT id
                FROM chunks
                WHERE document_id = ?1
            )
            ",
            [document_id],
        )?;

        tx.execute(
            "DELETE FROM chunks WHERE document_id = ?1",
            [document_id],
        )?;

        tx.execute(
            "DELETE FROM documents WHERE id = ?1",
            [document_id],
        )?;

        tx.commit()?;

        Ok(())
    }

    pub fn list_collections(
        &self,
    ) -> anyhow::Result<Vec<CollectionRow>> {
        let conn = self.connection()?;

        let mut statement = conn.prepare(
            "
            SELECT
                c.id,
                c.name,
                c.parent_id,
                COUNT(cd.document_id)
            FROM collections c
            LEFT JOIN collection_documents cd
                ON cd.collection_id = c.id
            GROUP BY c.id
            ORDER BY c.name COLLATE NOCASE
            "
        )?;

        let rows = statement
            .query_map([], |row| {
                Ok(CollectionRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    document_count: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(rows)
    }

    pub fn create_collection(
        &self,
        name: &str,
        parent_id: Option<i64>,
    ) -> anyhow::Result<i64> {
        let conn = self.connection()?;

        conn.execute(
            "
            INSERT INTO collections (
                name,
                parent_id
            )
            VALUES (?1, ?2)
            ",
            params![
                name.trim(),
                parent_id
            ],
        )?;

        Ok(conn.last_insert_rowid())
    }

    pub fn move_document_to_collection(
        &self,
        document_id: i64,
        collection_id: Option<i64>,
    ) -> anyhow::Result<()> {
        let conn = self.connection()?;

        if let Some(collection_id) = collection_id {
            conn.execute(
                "
                INSERT INTO collection_documents (
                    document_id,
                    collection_id
                )
                VALUES (?1, ?2)

                ON CONFLICT(document_id)
                DO UPDATE SET
                    collection_id = excluded.collection_id
                ",
                params![
                    document_id,
                    collection_id
                ],
            )?;
        } else {
            conn.execute(
                "
                DELETE FROM collection_documents
                WHERE document_id = ?1
                ",
                [document_id],
            )?;
        }

        Ok(())
    }

    pub fn delete_collection(
        &self,
        collection_id: i64,
    ) -> anyhow::Result<()> {
        let conn = self.connection()?;

        conn.execute(
            "
            DELETE FROM collections
            WHERE id = ?1
            ",
            [collection_id],
        )?;

        Ok(())
    }

    fn connection(
        &self,
    ) -> anyhow::Result<std::sync::MutexGuard<'_, Connection>> {
        self.connection
            .lock()
            .map_err(|_| anyhow::anyhow!("database lock poisoned"))
    }
    
    pub fn counts(&self) -> anyhow::Result<(i64, i64)> {
        let conn = self.connection.lock().map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
        let docs = conn.query_row("SELECT COUNT(*) FROM documents", [], |r| r.get(0))?;
        let chunks = conn.query_row("SELECT COUNT(*) FROM chunks", [], |r| r.get(0))?;
        Ok((docs, chunks))
    }

    pub fn list_documents(&self) -> anyhow::Result<Vec<DocumentRow>> {
        let conn = self.connection.lock().map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
        let mut stmt = conn.prepare(
            "SELECT
                d.id,
                d.filename,
                COUNT(c.id) AS chunk_count,
                cd.collection_id
            FROM documents d
            LEFT JOIN chunks c
                ON c.document_id = d.id
            LEFT JOIN collection_documents cd
                ON cd.document_id = d.id
            GROUP BY
                d.id,
                d.filename,
                cd.collection_id
            ORDER BY d.filename COLLATE NOCASE"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(DocumentRow {
                id: row.get(0)?, filename: row.get(1)?,  chunk_count: row.get(2)?, collection_id: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn upsert_document(&self, path: &Path, filename: &str, file_hash: &str, chunks: &[String]) -> anyhow::Result<i64> {
        let mut conn = self.connection.lock().map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
        let tx = conn.transaction()?;

        if let Ok(existing_id) = tx.query_row(
            "SELECT id FROM documents WHERE path = ?1",
            [path.to_string_lossy().as_ref()],
            |r| r.get::<_, i64>(0),
        ) {
            tx.execute("DELETE FROM chunks_fts WHERE document_id = ?1", [existing_id])?;
            tx.execute("DELETE FROM chunks WHERE document_id = ?1", [existing_id])?;
            tx.execute(
                "UPDATE documents SET filename = ?1, file_hash = ?2, created_at = CURRENT_TIMESTAMP WHERE id = ?3",
                params![filename, file_hash, existing_id],
            )?;
        } else {
            tx.execute(
                "INSERT INTO documents(filename, path, file_hash) VALUES (?1, ?2, ?3)",
                params![filename, path.to_string_lossy().as_ref(), file_hash],
            )?;
        }

        let document_id: i64 = tx.query_row(
            "SELECT id FROM documents WHERE path = ?1",
            [path.to_string_lossy().as_ref()],
            |r| r.get(0),
        )?;

        for (chunk_index, text) in chunks.iter().enumerate() {
            tx.execute(
                "INSERT INTO chunks(document_id, chunk_index, text) VALUES (?1, ?2, ?3)",
                params![document_id, chunk_index as i64, text],
            )?;
            let chunk_id = tx.last_insert_rowid();
            tx.execute(
                "INSERT INTO chunks_fts(text, chunk_id, document_id) VALUES (?1, ?2, ?3)",
                params![text, chunk_id, document_id],
            )?;
        }

        tx.commit()?;
        Ok(document_id)
    }

    pub fn search(&self, query: &str, limit: usize) -> anyhow::Result<Vec<SearchResult>> {
        let fts_query = normalize_fts_query(query);
        if fts_query.is_empty() { return Ok(Vec::new()); }

        let conn = self.connection.lock().map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
        let mut stmt = conn.prepare(
            "SELECT c.document_id, d.filename, c.id, c.chunk_index, c.text, bm25(chunks_fts) AS score\n             FROM chunks_fts\n             JOIN chunks c ON c.id = chunks_fts.chunk_id\n             JOIN documents d ON d.id = c.document_id\n             WHERE chunks_fts MATCH ?1\n             ORDER BY score\n             LIMIT ?2"
        )?;
        let rows = stmt.query_map(params![fts_query, limit as i64], |row| {
            Ok(SearchResult {
                document_id: row.get(0)?, filename: row.get(1)?, chunk_id: row.get(2)?,
                chunk_index: row.get(3)?, text: row.get(4)?, score: row.get(5)?
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn read_document_chunks(&self, document_id: i64, limit: usize) -> anyhow::Result<Vec<String>> {
        let conn = self.connection.lock().map_err(|_| anyhow::anyhow!("database lock poisoned"))?;
        let mut stmt = conn.prepare("SELECT text FROM chunks WHERE document_id = ?1 ORDER BY chunk_index LIMIT ?2")?;
        let rows = stmt.query_map(params![document_id, limit as i64], |row| row.get::<_, String>(0))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn save_embedding(
            &self,
            chunk_id: i64,
            model: &str,
            vector: &[f32],
        ) -> anyhow::Result<()> {
            let conn = self.connection()?;

            let blob = vector_to_blob(vector);

            conn.execute(
                "
                INSERT OR REPLACE INTO chunk_embeddings
                    (chunk_id, model, dimensions, vector)
                VALUES (?1, ?2, ?3, ?4)
                ",
                rusqlite::params![
                    chunk_id,
                    model,
                    vector.len() as i64,
                    blob
                ],
            )?;

            Ok(())
    }

    pub fn chunks_missing_embeddings(
        &self,
        model: &str,
    ) -> anyhow::Result<Vec<(i64, String)>> {
        let conn = self.connection()?;

        let mut stmt = conn.prepare(
            "
            SELECT c.id, c.text
            FROM chunks c
            LEFT JOIN chunk_embeddings e
                ON e.chunk_id = c.id
                AND e.model = ?1
            WHERE e.chunk_id IS NULL
            ORDER BY c.id
            "
        )?;

        let rows = stmt.query_map(
            [model],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                ))
            },
        )?;

        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn load_embeddings(
        &self,
        model: &str,
    ) -> anyhow::Result<Vec<StoredEmbedding>> {
        let conn = self.connection()?;

        let mut stmt = conn.prepare(
            "
            SELECT
                c.id,
                c.document_id,
                d.filename,
                c.chunk_index,
                c.text,
                e.vector
            FROM chunk_embeddings e
            JOIN chunks c
                ON c.id = e.chunk_id
            JOIN documents d
                ON d.id = c.document_id
            WHERE e.model = ?1
            "
        )?;

        let rows = stmt.query_map(
            [model],
            |row| {
                let blob: Vec<u8> = row.get(5)?;

                Ok(StoredEmbedding {
                    chunk_id: row.get(0)?,
                    document_id: row.get(1)?,
                    filename: row.get(2)?,
                    chunk_index: row.get(3)?,
                    text: row.get(4)?,
                    vector: blob_to_vector(&blob),
                })
            },
        )?;

        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }
        
}

