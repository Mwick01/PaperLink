use crate::{
    chunking::chunk_exam_text,
    database::Database,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub document_id: i64,
    pub filename: String,
    pub chunks_added: usize,
}

pub fn import_pdf(db: &Database, path: &Path) -> anyhow::Result<ImportResult> {
    let bytes = std::fs::read(path)?;
    let text = pdf_extract::extract_text_from_mem(&bytes)?;
    if text.trim().is_empty() {
        anyhow::bail!("No extractable text found. Scanned PDFs will need OCR in a later version.");
    }

    let chunks = chunk_exam_text(&text);
    let file_hash = hex::encode(Sha256::digest(&bytes));
    let filename = path.file_name()
        .and_then(|v| v.to_str())
        .ok_or_else(|| anyhow::anyhow!("invalid file name"))?
        .to_string();

    let document_id = db.upsert_document(path, &filename, &file_hash, &chunks)?;
    Ok(ImportResult { document_id, filename, chunks_added: chunks.len() })
}


