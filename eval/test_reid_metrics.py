"""Unit tests for the S2 metric functions (M2-T6).

These exercise the math on hand-made vectors only -- they are not system
measurements and produce no RESULTS.md rows (CLAUDE.md rule 10). Real S2
numbers require the EPFL-POM identity-labelled splits plus OSNet weights;
see docs/RESULTS.md (S2/STATUS/BLOCKED).
"""

from __future__ import annotations

from eval.metrics.reid import (
    cosine_similarity,
    precision_recall_at_threshold,
    rank1_and_map,
)


def test_cosine_self_similarity_is_one() -> None:
    assert abs(cosine_similarity([1.0, 0.0], [1.0, 0.0]) - 1.0) < 1e-9


def test_rank1_and_map_on_separable_identities() -> None:
    queries = [[1.0, 0.0], [0.0, 1.0]]
    query_ids = ["a", "b"]
    gallery = [[1.0, 0.0], [0.0, 1.0], [-1.0, 0.0]]
    gallery_ids = ["a", "b", "c"]
    rank1, mean_ap = rank1_and_map(queries, query_ids, gallery, gallery_ids)
    assert rank1 == 1.0
    assert mean_ap == 1.0


def test_precision_recall_at_threshold_counts_only_above() -> None:
    similarities = [0.9, 0.8, 0.4, 0.2]
    labels = [True, False, True, False]
    precision, recall, n_above = precision_recall_at_threshold(similarities, labels, 0.5)
    assert n_above == 2
    assert precision == 0.5
    assert recall == 0.5
