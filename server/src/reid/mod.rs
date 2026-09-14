//! Cross-camera Re-ID vector search (M2-T2, D7, D9, D15).
//!
//! The pgvector HNSW index on ``reid_candidates.embedding`` already exists
//! in the baseline migration -- this module never recreates it.
//!
//! The operating threshold is NOT hardcoded here: S2 has not measured it
//! yet, so there is no honest default to write (CLAUDE.md rule 10). Every
//! entry point takes ``base_threshold`` explicitly from the caller, and the
//! topology prior lowers it via ``adjusted_threshold`` (D15: the prior
//! modulates the threshold, it never gates execution).

pub mod pipeline;
pub mod search;
pub mod topology;
