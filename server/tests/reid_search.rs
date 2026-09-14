//! M2-T2. Vector search tests: self-similarity, random dissimilarity,
//! and schema rejection of candidates missing threshold/prior.
//!
//! Pure-function tests (no live Postgres): they prove the similarity and
//! schema properties the DB path depends on. The ``find_candidates`` SQL
//! itself runs against the real schema in CI with the database up; the
//! HNSW index it relies on comes from the baseline migration and is never
//! recreated here.

use server::reid::search::{adjusted_threshold, cosine_similarity, CandidateMatch};

const EMBEDDING_DIM: usize = 512;

fn unit_vector(seed: u64) -> Vec<f32> {
    // Deterministic pseudo-random unit vector: no RNG crate needed.
    let mut values = Vec::with_capacity(EMBEDDING_DIM);
    let mut state = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
    for _ in 0..EMBEDDING_DIM {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let uniform = ((state >> 11) as f32) / (u64::MAX >> 11) as f32 - 0.5;
        values.push(uniform);
    }
    let norm: f32 = values.iter().map(|v| v * v).sum::<f32>().sqrt();
    values.iter().map(|v| v / norm).collect()
}

#[test]
fn stored_embedding_compared_to_itself_returns_similarity_above_0_999() {
    let stored = unit_vector(42);
    let similarity = cosine_similarity(&stored, &stored).expect("valid embeddings");
    assert!(
        similarity > 0.999,
        "self-similarity must exceed 0.999, got {similarity}"
    );
}

#[test]
fn random_vector_compared_to_stored_returns_similarity_well_below_threshold() {
    // 0.6 here is a test-only comparison point, not the operating
    // threshold (S2 unmeasured -- CLAUDE.md rule 10). Random 512-d unit
    // vectors concentrate near cosine 0, far below any plausible bar.
    let stored = unit_vector(1);
    let random = unit_vector(999);
    let similarity = cosine_similarity(&stored, &random).expect("valid embeddings");
    assert!(
        similarity < 0.3,
        "random-vector similarity must sit well below threshold, got {similarity}"
    );
    let threshold = adjusted_threshold(0.6, 0.0).expect("valid threshold");
    assert!(similarity < threshold);
}

#[test]
fn missing_threshold_used_fails_schema_validation() {
    let payload = serde_json::json!({
        "candidate_id": 7,
        "similarity": 0.81,
        "prior_adjustment": -0.05,
        "expected_from": null,
        "expected_window": null,
    });
    let parsed: Result<CandidateMatch, _> = serde_json::from_value(payload);
    assert!(parsed.is_err(), "candidate without threshold_used must be rejected");
}

#[test]
fn missing_prior_adjustment_fails_schema_validation() {
    let payload = serde_json::json!({
        "candidate_id": 7,
        "similarity": 0.81,
        "threshold_used": 0.65,
        "expected_from": null,
        "expected_window": null,
    });
    let parsed: Result<CandidateMatch, _> = serde_json::from_value(payload);
    assert!(parsed.is_err(), "candidate without prior_adjustment must be rejected");
}

#[test]
fn full_candidate_parses_and_round_trips() {
    let payload = serde_json::json!({
        "candidate_id": 7,
        "similarity": 0.81,
        "threshold_used": 0.65,
        "prior_adjustment": -0.05,
        "expected_from": null,
        "expected_window": null,
    });
    let parsed: CandidateMatch = serde_json::from_value(payload).expect("full candidate parses");
    assert_eq!(parsed.threshold_used, 0.65);
    assert_eq!(parsed.prior_adjustment, -0.05);
}

#[test]
fn prior_outside_minus_0_15_to_0_is_rejected() {
    assert!(adjusted_threshold(0.6, 0.05).is_err());
    assert!(adjusted_threshold(0.6, -0.2).is_err());
    assert!(adjusted_threshold(0.6, -0.15).is_ok());
    assert!(adjusted_threshold(0.6, 0.0).is_ok());
}
