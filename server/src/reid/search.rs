//! Vector storage and similarity search (M2-T2).
//!
//! pgvector cosine distance via the existing HNSW index on
//! ``reid_candidates.embedding`` (baseline migration -- do not recreate).
//! Every ``CandidateMatch`` carries ``threshold_used`` and
//! ``prior_adjustment``: a candidate without them is invalid per
//! API_CONTRACTS.md §4 ("Never return a candidate without
//! ``threshold_used`` and ``prior_adjustment``").

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use ts_rs::TS;
use uuid::Uuid;

/// Re-ID embeddings are 512-d (STACK.md §5: OSNet, 512-d).
pub const EMBEDDING_DIM: usize = 512;

/// D15: the topology prior lowers the threshold by at most this much.
/// Negative because it is added to the base threshold.
pub const MAX_PRIOR_ADJUSTMENT: f32 = -0.15;

#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("invalid embedding: {0}")]
    InvalidEmbedding(String),
    #[error("invalid threshold: {0}")]
    InvalidThreshold(String),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

/// Half-open arrival window the topology prior predicted (D15). Both ends
/// are case-clock timestamps (D16), never system time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct TimeWindow {
    #[serde(with = "time::serde::rfc3339")]
    #[ts(type = "string")]
    pub start: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    #[ts(type = "string")]
    pub end: OffsetDateTime,
}

/// One candidate match. ``threshold_used`` and ``prior_adjustment`` are
/// plain (non-optional) floats: serde rejects any payload that omits them,
/// which is what makes "a candidate without threshold_used and
/// prior_adjustment is invalid" a schema property rather than a convention.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct CandidateMatch {
    // Wire integers are JSON numbers (see entities.rs MergeProposal).
    #[ts(type = "number")]
    pub candidate_id: i64,
    pub similarity: f32,
    pub threshold_used: f32,
    pub prior_adjustment: f32,
    pub expected_from: Option<Uuid>,
    pub expected_window: Option<TimeWindow>,
}

/// Cosine similarity between two embeddings. Both must be non-empty, the
/// same length, and ``EMBEDDING_DIM`` long; returns a value in [-1, 1].
/// Self-comparison of a stored embedding returns ~1.0.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> Result<f32, SearchError> {
    if a.len() != EMBEDDING_DIM || b.len() != EMBEDDING_DIM {
        return Err(SearchError::InvalidEmbedding(format!(
            "expected {EMBEDDING_DIM}-d embeddings, got {} and {}",
            a.len(),
            b.len()
        )));
    }
    let mut dot = 0.0f64;
    let mut norm_a = 0.0f64;
    let mut norm_b = 0.0f64;
    for (x, y) in a.iter().zip(b.iter()) {
        if !x.is_finite() || !y.is_finite() {
            return Err(SearchError::InvalidEmbedding(
                "embedding contains non-finite value".to_string(),
            ));
        }
        dot += f64::from(*x) * f64::from(*y);
        norm_a += f64::from(*x) * f64::from(*x);
        norm_b += f64::from(*y) * f64::from(*y);
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom == 0.0 {
        return Err(SearchError::InvalidEmbedding("zero-norm embedding".to_string()));
    }
    Ok((dot / denom) as f32)
}

/// D15: the prior modulates the threshold, it does not gate execution.
/// ``prior_adjustment`` is in [-0.15, 0.0]; the adjusted threshold is
/// ``base + prior`` (a negative prior lowers the bar inside the expected
/// window). Values outside the range are rejected rather than clamped:
/// silently clamping a miscomputed prior would hide a topology bug.
pub fn adjusted_threshold(base_threshold: f32, prior_adjustment: f32) -> Result<f32, SearchError> {
    if !base_threshold.is_finite() || base_threshold < 0.0 || base_threshold > 1.0 {
        return Err(SearchError::InvalidThreshold(format!(
            "base_threshold {base_threshold} must be within [0, 1]"
        )));
    }
    if !prior_adjustment.is_finite()
        || prior_adjustment < MAX_PRIOR_ADJUSTMENT
        || prior_adjustment > 0.0
    {
        return Err(SearchError::InvalidThreshold(format!(
            "prior_adjustment {prior_adjustment} must be within [{MAX_PRIOR_ADJUSTMENT}, 0.0] (D15)"
        )));
    }
    Ok((base_threshold + prior_adjustment).clamp(0.0, 1.0))
}

/// Formats an embedding as a pgvector literal (``[0.1,0.2,...]``) for the
/// ``<=>`` cosine-distance operator. The HNSW index serves this ordering;
/// no index is created here (baseline owns it).
pub fn format_vector_literal(embedding: &[f32]) -> Result<String, SearchError> {
    if embedding.len() != EMBEDDING_DIM {
        return Err(SearchError::InvalidEmbedding(format!(
            "expected {EMBEDDING_DIM}-d embedding, got {}",
            embedding.len()
        )));
    }
    let mut out = String::with_capacity(embedding.len() * 8 + 2);
    out.push('[');
    for (i, value) in embedding.iter().enumerate() {
        if !value.is_finite() {
            return Err(SearchError::InvalidEmbedding(
                "embedding contains non-finite value".to_string(),
            ));
        }
        if i > 0 {
            out.push(',');
        }
        out.push_str(&value.to_string());
    }
    out.push(']');
    Ok(out)
}

/// Finds candidates for a target embedding (M2-T2).
///
/// ``base_threshold`` is explicit because S2 has not measured the
/// operating threshold yet (CLAUDE.md rule 10: no invented default).
/// Only matches with ``similarity > adjusted_threshold(base, prior)``
/// are returned, ordered by similarity descending. Every returned match
/// carries the ``threshold_used`` and ``prior_adjustment`` it cleared.
#[allow(clippy::too_many_arguments)]
pub async fn find_candidates(
    pool: &PgPool,
    target_embedding: Vec<f32>,
    camera_id: Uuid,
    ts: OffsetDateTime,
    base_threshold: f32,
    prior_adjustment: f32,
    expected_from: Option<Uuid>,
    expected_window: Option<TimeWindow>,
) -> Result<Vec<CandidateMatch>, SearchError> {
    if target_embedding.len() != EMBEDDING_DIM {
        return Err(SearchError::InvalidEmbedding(format!(
            "expected {EMBEDDING_DIM}-d target embedding, got {}",
            target_embedding.len()
        )));
    }
    let threshold = adjusted_threshold(base_threshold, prior_adjustment)?;
    let literal = format_vector_literal(&target_embedding)?;

    // Cosine distance via pgvector; similarity = 1 - distance. The
    // ``camera_id`` / ``ts`` scoping keeps the gallery to this camera's
    // recent tracklets; the threshold comparison itself happens in Rust so
    // the value recorded in ``threshold_used`` is exactly the value tested.
    let rows: Vec<(i64, f64)> = sqlx::query_as(
        "SELECT id, (1 - (embedding <=> $1::vector)) AS similarity \
         FROM reid_candidates \
         WHERE camera_id = $2 AND ts <= $3 AND embedding IS NOT NULL \
         ORDER BY embedding <=> $1::vector LIMIT 20",
    )
    .bind(&literal)
    .bind(camera_id)
    .bind(ts)
    .fetch_all(pool)
    .await?;

    let mut matches = Vec::new();
    for (id, similarity) in rows {
        let similarity = similarity as f32;
        if similarity > threshold {
            matches.push(CandidateMatch {
                candidate_id: id,
                similarity,
                threshold_used: threshold,
                prior_adjustment,
                expected_from,
                expected_window: expected_window.clone(),
            });
        }
    }
    Ok(matches)
}
