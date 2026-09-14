"""Unit tests for the weight-math mirror (M4-T4, D27).

These verify formula PROPERTIES on version-1 values, not production
rows: two evidence rows outscore one, and a year-old row contributes
less than a day-old row. The numbers below are hand-made inputs to
pure math, not measurements (rule 10); the S5 calibration verdict
lives in RESULTS.md, not here.
"""

from __future__ import annotations

from eval.metrics.graph import (
    VERSION_1_HALF_LIFE_DAYS,
    VERSION_1_PARAMS,
    base_score,
    decay_contribution,
    edge_weight,
)


def test_two_rows_outscore_one_row_same_type_recency() -> None:
    one = edge_weight("CALLED", [0.0])
    two = edge_weight("CALLED", [0.0, 0.0])
    assert two > one > 0.0


def test_year_old_row_contributes_less_than_day_old_row() -> None:
    assert VERSION_1_HALF_LIFE_DAYS == 180
    base = base_score(VERSION_1_PARAMS, "CALLED")
    year_old = decay_contribution(base, 365.0, VERSION_1_HALF_LIFE_DAYS)
    day_old = decay_contribution(base, 1.0, VERSION_1_HALF_LIFE_DAYS)
    assert 0.0 < year_old < day_old < base


def test_unknown_type_scores_zero_like_sql_coalesce() -> None:
    assert base_score(VERSION_1_PARAMS, "INVENTED_TYPE") == 0.0
    assert edge_weight("INVENTED_TYPE", [0.0, 0.0]) == 0.0


def test_no_evidence_weighs_zero() -> None:
    assert edge_weight("CALLED", []) == 0.0
