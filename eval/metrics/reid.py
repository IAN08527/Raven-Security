"""S2 metric functions (EVALUATION.md §2, M2-T6).

Pure functions over embedding vectors and identity labels: rank-1 and mAP
for the embedder, precision/recall at the operating threshold (the number
that matters most -- a false match is the harm this system can cause).

Provenance (D19) is enforced by the harness (`eval/run_all.py`
`check_provenance`), not here: these functions take numeric vectors, and
the caller is responsible for only feeding `benchmark`/`collected` rows.
No function here invents an operating threshold; every threshold is an
explicit argument.
"""

from __future__ import annotations

import math


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Cosine similarity in [-1, 1]."""
    if len(a) != len(b) or not a:
        raise ValueError("cosine_similarity requires two non-empty vectors of equal length")
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        raise ValueError("cosine_similarity: zero-norm vector")
    return dot / (norm_a * norm_b)


def rank1_and_map(
    query_embeddings: list[list[float]],
    query_ids: list[str],
    gallery_embeddings: list[list[float]],
    gallery_ids: list[str],
) -> tuple[float, float]:
    """Rank-1 accuracy and mAP over one query/gallery split.

    For each query, gallery entries are ranked by cosine similarity;
    rank-1 counts queries whose top-1 shares the query identity; AP per
    query is averaged over its relevant ranks, then meaned.
    """
    if len(query_embeddings) != len(query_ids) or len(gallery_embeddings) != len(gallery_ids):
        raise ValueError("embeddings and ids must be parallel")
    if not query_embeddings or not gallery_embeddings:
        raise ValueError("rank1_and_map requires at least one query and one gallery entry")

    rank1_hits = 0
    aps: list[float] = []
    for query, query_id in zip(query_embeddings, query_ids):
        ranked = sorted(
            range(len(gallery_embeddings)),
            key=lambda i: cosine_similarity(query, gallery_embeddings[i]),
            reverse=True,
        )
        if gallery_ids[ranked[0]] == query_id:
            rank1_hits += 1
        relevant = 0
        precision_sum = 0.0
        for rank, gallery_idx in enumerate(ranked, start=1):
            if gallery_ids[gallery_idx] == query_id:
                relevant += 1
                precision_sum += relevant / rank
        aps.append(precision_sum / relevant if relevant else 0.0)
    return rank1_hits / len(query_embeddings), sum(aps) / len(aps)


def precision_recall_at_threshold(
    similarities: list[float], labels: list[bool], threshold: float
) -> tuple[float, float, int]:
    """Precision and recall at an explicit operating threshold, plus the
    count above threshold. `labels[i]` is whether pair `i` is a true match."""
    if len(similarities) != len(labels):
        raise ValueError("similarities and labels must be parallel")
    if not similarities:
        raise ValueError("precision_recall_at_threshold requires at least one pair")
    above = [label for sim, label in zip(similarities, labels) if sim > threshold]
    total_relevant = sum(labels)
    if not above:
        return 0.0, 0.0, 0
    precision = sum(above) / len(above)
    recall = sum(above) / total_relevant if total_relevant else 0.0
    return precision, recall, len(above)
