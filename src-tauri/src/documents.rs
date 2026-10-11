use crate::database::Database;
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

    let chunks = chunk_text(&text, 1800, 220);
    let file_hash = hex::encode(Sha256::digest(&bytes));
    let filename = path.file_name()
        .and_then(|v| v.to_str())
        .ok_or_else(|| anyhow::anyhow!("invalid file name"))?
        .to_string();

    let document_id = db.upsert_document(path, &filename, &file_hash, &chunks)?;
    Ok(ImportResult { document_id, filename, chunks_added: chunks.len() })
}

fn chunk_text(text: &str, target_chars: usize, overlap_chars: usize) -> Vec<String> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let paragraphs: Vec<&str> = normalized
        .split("\n\n")
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();

    let mut chunks = Vec::new();
    let mut current = String::new();

    for paragraph in paragraphs {
        if current.len() + paragraph.len() + 2 <= target_chars {
            if !current.is_empty() { current.push_str("\n\n"); }
            current.push_str(paragraph);
            continue;
        }

        if !current.trim().is_empty() {
            chunks.push(current.trim().to_string());
        }

        let overlap = chunks.last()
            .map(|last| tail_chars(last, overlap_chars))
            .unwrap_or_default();
        current = overlap;
        if !current.is_empty() { current.push_str("\n\n"); }

        if paragraph.len() <= target_chars {
            current.push_str(paragraph);
        } else {
            for piece in split_by_chars(paragraph, target_chars) {
                if !current.trim().is_empty() { chunks.push(current.trim().to_string()); }
                current = tail_chars(piece, overlap_chars);
                chunks.push(piece.to_string());
                current.clear();
            }
        }
    }

    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }
    chunks
}

fn tail_chars(text: &str, count: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    let start = chars.len().saturating_sub(count);
    chars[start..].iter().collect()
}

fn split_by_chars(text: &str, max_chars: usize) -> Vec<&str> {
    if text.len() <= max_chars { return vec![text]; }
    let mut out = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let mut end = (start + max_chars).min(text.len());
        while !text.is_char_boundary(end) { end -= 1; }
        out.push(&text[start..end]);
        start = end;
    }
    out
}
