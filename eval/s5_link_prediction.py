"""S5 link-prediction over the Enron temporal communication network
(EVALUATION.md experiment S5, D27).

Temporal half of S5 only: role recovery stays BLOCKED (no licensed
covert-network dataset with role annotations — RESULTS.md prior rows).
Data: eval/datasets/enron_edges.csv from tools/build_enron_network.py
(CMU 2015-05-07 maildir, FERC public record, research distribution).

Method per consecutive snapshot pair (t, t+1):
- Split the edge list into 3 temporal snapshots by equal time intervals.
- Weighted graph at t: per-pair weight = SUM over the pair's snapshot-t
  emails of (email_weight * CALLED_base * exp(-ln2 * age_days / 180))
  with email_weight 1.0 (To:) or 0.5 (Cc:), age measured back from the
  pair's newest snapshot-t email. This is eval/metrics/graph.py's
  recompute_weight formula (weight_params version 1, half_life_days=180)
  with the documented extension that the To/Cc per-email weight
  multiplies the CALLED base — the Step-1 edge list carries that signal
  and the formula has no other slot for it.
- Scores: weighted = snapshot-t pair weight (0 for unseen pairs);
  baseline = unweighted degree product deg_t(u)*deg_t(v) (preferential
  attachment). Ranked highest-first; top-k (k = # actual t+1 edges in
  the candidate universe) predicted; AUC measured against actual t+1
  edges. AUC via sklearn (STACK-pinned, CPU-only, no egress).
- Candidate universe: nodes active in t (capped at the top 2000 by
  weighted degree when larger — deterministic, degree-ordered);
  positives = t+1 edges with both ends in the universe; negatives =
  universe non-edges, seeded-sampled (seed 42) when over 100k.

Two documented scope decisions (flagged here, not silent):
1. Out-of-range timestamps (before 1999 or after 2002, 0.075% of edges
   from malformed Date: headers — 2-digit years, typos) are excluded
   from the range before dividing by 3. A literal min..max split
   (1980..2044) would leave the outer snapshots nearly empty and the
   experiment degenerate; the corpus itself spans 1999-2002.
2. All Enron emails map to CALLED-type evidence: the corpus is a
   communication network standing in for CDR structure (EVALUATION.md
   §1.1), and CALLED is weight_params v1's communication type.

D27 rule: if weighted AUC is not better than unweighted degree on ANY
snapshot pair, D27 is flagged in docs/DECISIONS.md explicitly and the
finding is recorded honestly in RESULTS.md — never suppressed.

Appends one row per snapshot pair per metric (weighted_auc,
unweighted_auc, delta) to docs/RESULTS.md: Exp S5-enron, dataset
enron-cmu-2015, with the role-recovery-BLOCKED note.
"""

from __future__ import annotations

import csv
import math
import random
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "eval"))

from metrics.graph import VERSION_1_HALF_LIFE_DAYS, VERSION_1_PARAMS
from run_all import append_result_row

EDGES_PATH = REPO_ROOT / "eval" / "datasets" / "enron_edges.csv"

EXPERIMENT = "S5-enron"
DATASET = "enron-cmu-2015"

ROLE_NOTE = (
    "Enron communication network, temporal link prediction only. Role-recovery "
    "half of S5 remains BLOCKED pending licensed covert-network dataset with "
    "role annotations."
)

RANGE_START = datetime(1999, 1, 1, tzinfo=timezone.utc)
RANGE_END = datetime(2003, 1, 1, tzinfo=timezone.utc)
N_SNAPSHOTS = 3
MAX_NODES = 2000
MAX_NEGATIVES = 100_000
NEGATIVE_SEED = 42
CALLED_BASE = float(VERSION_1_PARAMS["CALLED"])
HALF_LIFE = float(VERSION_1_HALF_LIFE_DAYS)
LAMBDA = math.log(2) / HALF_LIFE


def parse_ts(raw: str) -> datetime:
    moment = datetime.fromisoformat(raw)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def pair_weight(stamps: list[tuple[datetime, float]]) -> float:
    """Decayed weight over one pair's snapshot evidence: SUM email_w *
    CALLED_base * exp(-lambda * age_days), aged from the pair's newest
    stamp (graph.py convention)."""
    if not stamps:
        return 0.0
    newest = max(ts for ts, _ in stamps)
    total = 0.0
    for ts, email_w in stamps:
        age_days = max((newest - ts).total_seconds() / 86400.0, 0.0)
        total += email_w * CALLED_BASE * math.exp(-LAMBDA * age_days)
    return total


def auc_rank(scores: list[float], labels: list[int]) -> float:
    """ROC AUC via sklearn (STACK-pinned CPU dependency, no egress)."""
    from sklearn.metrics import roc_auc_score  # type: ignore[import-untyped]

    if len({label for label in labels}) < 2:
        return float("nan")
    return float(roc_auc_score(labels, scores))


def main() -> int:
    senders: list[str] = []
    edges: list[tuple[str, str, datetime, float]] = []
    out_of_range = 0
    with EDGES_PATH.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            ts = parse_ts(row["ts"])
            if not (RANGE_START <= ts < RANGE_END):
                out_of_range += 1
                continue
            edges.append((row["src"], row["dst"], ts, float(row["weight"])))
            senders.append(row["src"])
    print(f"loaded={len(edges)} out_of_range_excluded={out_of_range}")

    lo = min(ts for _, _, ts, _ in edges)
    hi = max(ts for _, _, ts, _ in edges)
    span = (hi - lo) / N_SNAPSHOTS
    print(f"range={lo.isoformat()} .. {hi.isoformat()} snapshots={N_SNAPSHOTS}")

    snapshots: list[list[tuple[str, str, datetime, float]]] = [[] for _ in range(N_SNAPSHOTS)]
    for edge in edges:
        _, _, ts, _ = edge
        index = min(int((ts - lo) / span), N_SNAPSHOTS - 1)
        snapshots[index].append(edge)
    for i, snap in enumerate(snapshots):
        nodes = {s for s, _, _, _ in snap} | {d for _, d, _, _ in snap}
        print(f"snapshot {i}: edges={len(snap)} nodes={len(nodes)}")

    pair_results: list[tuple[int, float, float, float]] = []
    for t in range(N_SNAPSHOTS - 1):
        # -- Weighted graph at snapshot t.
        evidence: dict[tuple[str, str], list[tuple[datetime, float]]] = defaultdict(list)
        for src, dst, ts, weight in snapshots[t]:
            key = (src, dst) if src <= dst else (dst, src)
            evidence[key].append((ts, weight))
        weights = {pair: pair_weight(stamps) for pair, stamps in evidence.items()}

        nodes_t = list({s for s, _, _, _ in snapshots[t]} | {d for _, d, _, _ in snapshots[t]})
        if len(nodes_t) > MAX_NODES:
            strength: dict[str, float] = defaultdict(float)
            for (a, b), w in weights.items():
                strength[a] += w
                strength[b] += w
            nodes_t = sorted(nodes_t, key=lambda n: (-strength.get(n, 0.0), n))[:MAX_NODES]
            weights = {pair: w for pair, w in weights.items() if pair[0] in set(nodes_t) and pair[1] in set(nodes_t)}
            print(f"pair t={t}: node universe capped to top {MAX_NODES} by weighted degree")
        node_set = set(nodes_t)
        degree: dict[str, int] = defaultdict(int)
        for a, b in weights:
            degree[a] += 1
            degree[b] += 1

        # -- Actual edges at t+1 within the universe.
        actual: set[tuple[str, str]] = set()
        for src, dst, _, _ in snapshots[t + 1]:
            if src in node_set and dst in node_set and src != dst:
                actual.add((src, dst) if src <= dst else (dst, src))

        # -- Candidate universe: positives + sampled negatives.
        rng = random.Random(NEGATIVE_SEED)
        positives = sorted(actual)
        n_pos = len(positives)
        negatives: list[tuple[str, str]] = []
        universe = sorted(node_set)
        # Enumerate non-edges; sample when over cap (seeded, documented).
        index_of = {node: i for i, node in enumerate(universe)}
        all_negative_possible = (
            len(universe) * (len(universe) - 1) // 2 - len(weights)
        )
        if all_negative_possible <= MAX_NEGATIVES:
            weight_keys = set(weights)
            for i, a in enumerate(universe):
                for b in universe[i + 1 :]:
                    key = (a, b)
                    if key not in weight_keys and key not in actual:
                        negatives.append(key)
            print(f"pair t={t}->t+1: negatives enumerated fully ({len(negatives)})")
        else:
            seen: set[tuple[str, str]] = set()
            target = min(MAX_NEGATIVES, max(5 * n_pos, 20_000))
            attempts = 0
            while len(negatives) < target and attempts < target * 20:
                attempts += 1
                a, b = rng.sample(universe, 2)
                key = (a, b) if a <= b else (b, a)
                if key in weights or key in actual or key in seen:
                    continue
                seen.add(key)
                negatives.append(key)
            print(
                f"pair t={t}->t+1: negatives seeded-sampled "
                f"(seed={NEGATIVE_SEED}, {len(negatives)}/{all_negative_possible})"
            )
        _ = index_of

        pairs = positives + negatives
        labels = [1] * len(positives) + [0] * len(negatives)
        weighted_scores = [weights.get(pair, 0.0) for pair in pairs]
        unweighted_scores = [
            float(degree.get(pair[0], 0) * degree.get(pair[1], 0)) for pair in pairs
        ]
        weighted_auc = auc_rank(weighted_scores, labels)
        unweighted_auc = auc_rank(unweighted_scores, labels)
        delta = weighted_auc - unweighted_auc
        pair_results.append((t, weighted_auc, unweighted_auc, delta))

        # Top-k context for stdout (k = # positives). Ties broken by a
        # seeded shuffle FIRST: Python's stable sort would otherwise keep
        # positives (listed first) above negatives among equal scores and
        # inflate precision@k to 1.0 — a tie-order artifact, not signal.
        # AUC (roc_auc_score) credits ties 0.5 and is unaffected.
        tie_rng = random.Random(NEGATIVE_SEED)
        scored = list(zip(pairs, weighted_scores))
        tie_rng.shuffle(scored)
        ranked = sorted(scored, key=lambda item: -item[1])
        topk = {pair for pair, _ in ranked[:n_pos]} if n_pos else set()
        precision_at_k = len(topk & actual) / n_pos if n_pos else 0.0
        print(
            f"pair t={t}->t+1: n_pos={n_pos} n_neg={len(negatives)} "
            f"weighted_auc={weighted_auc:.4f} unweighted_auc={unweighted_auc:.4f} "
            f"delta={delta:+.4f} precision_at_k={precision_at_k:.4f}"
        )

    d27_tripped = any(weighted <= unweighted for _, weighted, unweighted, _ in pair_results)
    for t, weighted_auc, unweighted_auc, delta in pair_results:
        note = (
            f"{ROLE_NOTE} Snapshot pair t={t}->t+1 of {N_SNAPSHOTS} equal-interval "
            f"snapshots over {lo.isoformat()}..{hi.isoformat()}; CALLED-base decay "
            f"(half-life {HALF_LIFE:.0f}d) vs degree-product baseline; "
            f"out-of-range-date edges excluded: {out_of_range}."
        )
        if d27_tripped:
            note += (
                " D27-FINDING: weighted AUC not better than unweighted degree on "
                "at least one snapshot pair — scoring matrix is decoration for "
                "this data, see DECISIONS.md D27."
            )
        append_result_row(
            experiment=EXPERIMENT,
            dataset=DATASET,
            split=f"snapshots-t{t}-to-t{t + 1}",
            metric="weighted_auc",
            value=weighted_auc,
            note=note,
        )
        append_result_row(
            experiment=EXPERIMENT,
            dataset=DATASET,
            split=f"snapshots-t{t}-to-t{t + 1}",
            metric="unweighted_auc",
            value=unweighted_auc,
            note=note,
        )
        append_result_row(
            experiment=EXPERIMENT,
            dataset=DATASET,
            split=f"snapshots-t{t}-to-t{t + 1}",
            metric="delta_weighted_minus_unweighted",
            value=delta,
            note=note,
        )
    print(f"D27 {'TRIPPED' if d27_tripped else 'clear'}: {pair_results}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
