"""Edge-weight math shared with production (M4-T4, D27).

Formula mirror of the baseline `recompute_weight()` SQL function:
w = SUM over evidence of (base_type * exp(-lambda * age_days)) with
lambda = ln(2) / half_life_days, aged against the NEWEST evidence on
the edge (never wall-clock, D16). The SQL function is authoritative
for production; this module is the S5 calibration harness side, reading
the same versioned `weight_params` values. Parity between the two is a
standing requirement: if either changes formula, both change.

Version 1 values below are quoted verbatim from the baseline seed row
(prototype constants, explicitly unvalidated -- D27). S5 replaces them.
"""

from __future__ import annotations

import math

# Baseline weight_params version 1, verbatim (D27: unvalidated starting point).
VERSION_1_PARAMS = {
    "CALLED": 1,
    "TRANSFERRED_TO": 10,
    "CO_LOCATED": 10,
    "CO_ACCUSED": 25,
    "RESIDES_WITH": 15,
    "SEEN_WITH": 5,
}
VERSION_1_HALF_LIFE_DAYS = 180


def base_score(params: dict[str, float], rel_type: str) -> float:
    """Base score for one relationship type; unknown types score 0
    (matches the SQL `COALESCE(..., 0)`)."""
    return params.get(rel_type, 0.0)


def decay_contribution(base: float, age_days: float, half_life_days: float) -> float:
    """One evidence row's weight contribution. `age_days` is measured
    back from the newest evidence on the edge, floored at 0 (matches the
    SQL `GREATEST(..., 0)`)."""
    return base * math.exp(-math.log(2) * max(age_days, 0.0) / half_life_days)


def edge_weight(
    rel_type: str,
    ages_days: list[float],
    params: dict[str, float] | None = None,
    half_life_days: float = VERSION_1_HALF_LIFE_DAYS,
) -> float:
    """Total edge weight over its evidence ages. No evidence (or no
    newest timestamp, the SQL `ref_ts IS NULL` case) weighs 0."""
    if not ages_days:
        return 0.0
    table = params if params is not None else VERSION_1_PARAMS
    base = base_score(table, rel_type)
    newest = min(ages_days)
    return sum(decay_contribution(base, age - newest, half_life_days) for age in ages_days)
