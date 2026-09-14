"""M2-T3. Topology prior tests (D15, D16).

Every timestamp here is a fixed literal with an explicit zone -- no test
calls ``now()`` or uses the current date, matching the rule under test
(CLAUDE.md rule 3, D16). A clock-dependent test could never catch a
system-time leak in the code it exercises.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from engine.topology import CameraEdge, TopologyPrior

LAST_TS = datetime(2025, 11, 2, 14, 0, 0, tzinfo=UTC)


def _prior() -> TopologyPrior:
    return TopologyPrior(
        [
            CameraEdge(from_camera="cam_01", to_camera="cam_03", mean_travel_s=600, stddev_s=60),
            CameraEdge(from_camera="cam_01", to_camera="cam_04", mean_travel_s=300, stddev_s=30),
        ]
    )


def test_candidate_inside_expected_window_gets_maximum_reduction() -> None:
    prior = _prior()
    # Window from cam_01 is 14:08-14:12 (600s ± 120s); 14:10 is inside.
    result = prior.compute("cam_01", LAST_TS, "cam_03", LAST_TS + timedelta(seconds=600))
    assert result.prior_adjustment == -0.15
    assert result.expected_from == "cam_01"
    assert result.expected_window is not None
    assert result.expected_window.start == LAST_TS + timedelta(seconds=480)
    assert result.expected_window.end == LAST_TS + timedelta(seconds=720)


def test_candidate_with_no_edge_gets_zero_adjustment() -> None:
    prior = _prior()
    result = prior.compute("cam_01", LAST_TS, "cam_09", LAST_TS + timedelta(seconds=600))
    assert result.prior_adjustment == 0.0
    assert result.expected_from is None
    assert result.expected_window is None


def test_candidate_outside_window_on_valid_edge_gets_partial_adjustment() -> None:
    prior = _prior()
    # Well past the 14:08-14:12 window but on a valid edge: must be
    # strictly between -0.15 and 0.0 (D15: modulate, never gate).
    result = prior.compute("cam_01", LAST_TS, "cam_03", LAST_TS + timedelta(seconds=1200))
    assert -0.15 < result.prior_adjustment < 0.0, (
        f"outside-window prior must interpolate, got {result.prior_adjustment}"
    )
    assert result.expected_from == "cam_01"
    assert result.expected_window is not None


def test_window_edges_are_inclusive() -> None:
    prior = _prior()
    for offset_s in (480, 720):
        result = prior.compute("cam_01", LAST_TS, "cam_03", LAST_TS + timedelta(seconds=offset_s))
        assert result.prior_adjustment == -0.15


def test_compute_all_covers_every_camera_without_system_time() -> None:
    prior = _prior()
    results = prior.compute_all(
        "cam_01", LAST_TS, LAST_TS + timedelta(seconds=600), ["cam_03", "cam_04", "cam_09"]
    )
    assert set(results) == {"cam_03", "cam_04", "cam_09"}
    assert results["cam_03"].prior_adjustment == -0.15
    assert results["cam_09"].prior_adjustment == 0.0


def test_naive_datetimes_are_rejected_as_non_case_clock() -> None:
    prior = _prior()
    naive = datetime(2025, 11, 2, 14, 10, 0)
    try:
        prior.compute("cam_01", naive, "cam_03", LAST_TS)
    except ValueError:
        pass
    else:
        raise AssertionError("naive last_ts must be rejected (D16)")
