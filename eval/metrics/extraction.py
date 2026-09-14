"""S4 metric functions (EVALUATION.md §2, M4-T6, FR-3.4).

Entity-level precision/recall/F1 by type (exact type+span match),
span exact-match rate, and resolution metrics (pairwise precision/
recall plus B-cubed) over mention clusterings. Pure functions over
hand-built structures; provenance (D19) is enforced by the harness
(`eval/run_all.py`), not here. Merge precision is the number that
matters (an incorrect merge fuses two people's records); these
functions report it, they never assert it.
"""

from __future__ import annotations

Mention = tuple[str, int, int]  # (entity type, char_start, char_end)


def entity_prf_by_type(
    gold: list[Mention], predicted: list[Mention]
) -> dict[str, dict[str, float]]:
    """Exact-match PRF per entity type: a true positive shares type AND
    span. Returns `{type: {precision, recall, f1, gold_n, pred_n}}`."""
    types = sorted({mention[0] for mention in gold} | {mention[0] for mention in predicted})
    table: dict[str, dict[str, float]] = {}
    for typ in types:
        gold_set = {mention for mention in gold if mention[0] == typ}
        pred_set = {mention for mention in predicted if mention[0] == typ}
        hits = len(gold_set & pred_set)
        precision = hits / len(pred_set) if pred_set else 0.0
        recall = hits / len(gold_set) if gold_set else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        table[typ] = {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "gold_n": float(len(gold_set)),
            "pred_n": float(len(pred_set)),
        }
    return table


def span_exact_match_rate(gold: list[Mention], predicted: list[Mention]) -> float:
    """Fraction of gold mentions recovered with an exactly equal span
    (type must match too -- a right span with the wrong type is still a
    miss, since it would file evidence under the wrong entity)."""
    if not gold:
        raise ValueError("span_exact_match_rate requires at least one gold mention")
    gold_set = set(gold)
    hits = sum(1 for mention in predicted if mention in gold_set)
    return hits / len(gold)


def _pairs(clusters: list[set[str]]) -> set[frozenset[str]]:
    pairs: set[frozenset[str]] = set()
    for cluster in clusters:
        members = sorted(cluster)
        for i, first in enumerate(members):
            for second in members[i + 1 :]:
                pairs.add(frozenset((first, second)))
    return pairs


def pairwise_prf(
    gold_clusters: list[set[str]], predicted_clusters: list[set[str]]
) -> dict[str, float]:
    """Pairwise (MUC-style) precision/recall/F1 over coreferent mention
    pairs. Singleton mentions contribute no pairs by construction."""
    gold_pairs = _pairs(gold_clusters)
    pred_pairs = _pairs(predicted_clusters)
    hits = len(gold_pairs & pred_pairs)
    precision = hits / len(pred_pairs) if pred_pairs else 0.0
    recall = hits / len(gold_pairs) if gold_pairs else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": precision, "recall": recall, "f1": f1}


def bcubed(
    gold_clusters: list[set[str]], predicted_clusters: list[set[str]]
) -> dict[str, float]:
    """B-cubed precision/recall/F1: per-mention overlap between its gold
    and predicted clusters, averaged over mentions."""
    gold_of: dict[str, set[str]] = {}
    for cluster in gold_clusters:
        for mention in cluster:
            gold_of[mention] = cluster
    pred_of: dict[str, set[str]] = {}
    for cluster in predicted_clusters:
        for mention in cluster:
            pred_of[mention] = cluster
    mentions = set(gold_of) | set(pred_of)
    if not mentions:
        raise ValueError("bcubed requires at least one mention")
    precisions: list[float] = []
    recalls: list[float] = []
    for mention in mentions:
        gold = gold_of.get(mention, set())
        pred = pred_of.get(mention, set())
        overlap = len(gold & pred)
        precisions.append(overlap / len(pred) if pred else 0.0)
        recalls.append(overlap / len(gold) if gold else 0.0)
    precision = sum(precisions) / len(precisions)
    recall = sum(recalls) / len(recalls)
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": precision, "recall": recall, "f1": f1}
