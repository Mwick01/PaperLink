use crate::{
    database::{Database, SearchResult},
    embeddings::EmbeddingEngine,
};

pub fn cosine_similarity(
    a: &[f32],
    b: &[f32],
) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let mut dot = 0.0;
    let mut norm_a = 0.0;
    let mut norm_b = 0.0;

    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }

    dot / (norm_a.sqrt() * norm_b.sqrt())
}

pub fn semantic_search(
    db: &Database,
    embeddings: &EmbeddingEngine,
    query: &str,
    limit: usize,
) -> anyhow::Result<Vec<SearchResult>> {
    let query_vector = embeddings.embed(query)?;

    let stored =
        db.load_embeddings(embeddings.model_name())?;

    let mut scored = stored
        .into_iter()
        .map(|item| {
            let score = cosine_similarity(
                &query_vector,
                &item.vector,
            );

            SearchResult {
                document_id: item.document_id,
                filename: item.filename,
                chunk_id: item.chunk_id,
                chunk_index: item.chunk_index,
                text: item.text,
                score: score as f64,
            }
        })
        .collect::<Vec<_>>();

    scored.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    scored.truncate(limit);

    Ok(scored)
}

use std::collections::{
    hash_map::Entry,
    HashMap,
};

pub fn hybrid_search(
    db: &Database,
    embeddings: &EmbeddingEngine,
    query: &str,
    limit: usize,
) -> anyhow::Result<Vec<SearchResult>> {
    let candidate_limit = (limit * 4).max(20);

    // Exact/keyword results
    let keyword_results =
        db.search(query, candidate_limit)?;

    // Semantic results
    let semantic_results =
        semantic_search(
            db,
            embeddings,
            query,
            candidate_limit,
        )?;

    // Reciprocal Rank Fusion
    const RRF_K: f64 = 60.0;

    let mut fused:
        HashMap<i64, (SearchResult, f64)> =
        HashMap::new();

    for (rank, result) in
        keyword_results.into_iter().enumerate()
    {
        let contribution =
            1.0 / (RRF_K + rank as f64 + 1.0);

        match fused.entry(result.chunk_id) {
            Entry::Occupied(mut entry) => {
                entry.get_mut().1 += contribution;
            }

            Entry::Vacant(entry) => {
                entry.insert((result, contribution));
            }
        }
    }

    for (rank, result) in
        semantic_results.into_iter().enumerate()
    {
        let contribution =
            1.0 / (RRF_K + rank as f64 + 1.0);

        match fused.entry(result.chunk_id) {
            Entry::Occupied(mut entry) => {
                entry.get_mut().1 += contribution;
            }

            Entry::Vacant(entry) => {
                entry.insert((result, contribution));
            }
        }
    }

    let mut results = fused
        .into_values()
        .map(|(mut result, score)| {
            result.score = score;
            result
        })
        .collect::<Vec<_>>();

    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    results.truncate(limit);

    Ok(results)
}