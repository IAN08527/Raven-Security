"""Camera topology prior (M2-T3, D15, D10, D16).

Detection runs on all cameras continuously; the topology graph modulates
the match threshold rather than gating execution (D15: a prior on the
match score, not an on/off switch). An unmapped route still matches --
it just clears at the unadjusted base threshold.

Reads are from Neo4j over read-only Bolt credentials held by the engine
node (D10): this module never writes. All timestamps are case-clock
(``declared_start_ts + offset``, D16) -- nothing here reads system time.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

from pydantic import BaseModel, Field

MAX_PRIOR_REDUCTION = -0.15


class CameraEdgeModel(BaseModel):
    """Pydantic boundary for a LEADS_TO edge (CLAUDE.md conventions)."""

    from_camera: str = Field(min_length=1)
    to_camera: str = Field(min_length=1)
    mean_travel_s: float = Field(ge=0)
    stddev_s: float = Field(ge=0)


@dataclass(frozen=True)
class CameraEdge:
    from_camera: str
    to_camera: str
    mean_travel_s: float
    stddev_s: float


@dataclass(frozen=True)
class ExpectedWindow:
    """Predicted arrival window, both ends case-clock (D16)."""

    start: datetime
    end: datetime


@dataclass(frozen=True)
class PriorResult:
    camera_id: str
    expected_from: str | None
    expected_window: ExpectedWindow | None
    prior_adjustment: float


def _require_case_clock(ts: datetime, name: str) -> None:
    if ts.tzinfo is None:
        raise ValueError(f"{name} must be tz-aware case-clock time (D16), got naive datetime")


class TopologyPrior:
    """Threshold prior from last confirmed sighting (D15).

    Constructed from an explicit edge list so tests never need a live
    Neo4j connection; ``load_edges_from_neo4j`` below is the only function
    that touches the network, and only with read-only credentials (D10).
    """

    def __init__(self, edges: list[CameraEdge]) -> None:
        for edge in edges:
            CameraEdgeModel(
                from_camera=edge.from_camera,
                to_camera=edge.to_camera,
                mean_travel_s=edge.mean_travel_s,
                stddev_s=edge.stddev_s,
            )
        self._edges: dict[tuple[str, str], CameraEdge] = {
            (edge.from_camera, edge.to_camera): edge for edge in edges
        }

    def compute(
        self,
        last_camera: str,
        last_ts: datetime,
        candidate_camera: str,
        candidate_ts: datetime,
    ) -> PriorResult:
        """Prior for one candidate sighting.

        Window is ``last_ts + mean ± 2*stddev``. Inside the window the
        adjustment is maximum (-0.15); with no edge it is 0.0; outside a
        valid edge's window it decays exponentially toward 0.0 with
        distance beyond the window scaled by ``stddev`` -- always strictly
        between -0.15 and 0.0 for finite misses when ``stddev > 0``.
        """
        _require_case_clock(last_ts, "last_ts")
        _require_case_clock(candidate_ts, "candidate_ts")
        edge = self._edges.get((last_camera, candidate_camera))
        if edge is None:
            return PriorResult(
                camera_id=candidate_camera,
                expected_from=None,
                expected_window=None,
                prior_adjustment=0.0,
            )
        window = ExpectedWindow(
            start=last_ts + timedelta(seconds=edge.mean_travel_s - 2 * edge.stddev_s),
            end=last_ts + timedelta(seconds=edge.mean_travel_s + 2 * edge.stddev_s),
        )
        if window.start <= candidate_ts <= window.end:
            return PriorResult(
                camera_id=candidate_camera,
                expected_from=last_camera,
                expected_window=window,
                prior_adjustment=MAX_PRIOR_REDUCTION,
            )
        if edge.stddev_s <= 0:
            # Zero-variance edge: the window is exact; any miss gets no prior.
            return PriorResult(
                camera_id=candidate_camera,
                expected_from=last_camera,
                expected_window=window,
                prior_adjustment=0.0,
            )
        half_width_s = 2 * edge.stddev_s
        centre = last_ts + timedelta(seconds=edge.mean_travel_s)
        beyond_s = abs((candidate_ts - centre).total_seconds()) - half_width_s
        adjustment = MAX_PRIOR_REDUCTION * math.exp(-beyond_s / half_width_s)
        # Clamp for float hygiene; exp() keeps this strictly inside (-0.15, 0).
        adjustment = min(max(adjustment, MAX_PRIOR_REDUCTION), 0.0)
        if adjustment == MAX_PRIOR_REDUCTION:
            adjustment = math.nextafter(MAX_PRIOR_REDUCTION, 0.0)
        return PriorResult(
            camera_id=candidate_camera,
            expected_from=last_camera,
            expected_window=window,
            prior_adjustment=adjustment,
        )

    def compute_all(
        self,
        last_camera: str,
        last_ts: datetime,
        candidate_ts: datetime,
        camera_ids: list[str],
    ) -> dict[str, PriorResult]:
        """Prior for every other camera at one candidate timestamp."""
        return {
            camera_id: self.compute(last_camera, last_ts, camera_id, candidate_ts)
            for camera_id in camera_ids
        }


def load_edges_from_neo4j(uri: str, user: str, password: str) -> list[CameraEdge]:
    """Read LEADS_TO edges over read-only Bolt (D10, engine node).

    Only called by the engine node at startup / refresh; never in tests.
    The credentials supplied must be the read-only topology role -- this
    function issues a single MATCH and has no write path.
    """
    from neo4j import GraphDatabase

    driver = GraphDatabase.driver(uri, auth=(user, password))
    try:
        with driver.session() as session:
            records = session.run(
                "MATCH (a:Camera)-[e:LEADS_TO]->(b:Camera) "
                "RETURN a.code AS from_camera, b.code AS to_camera, "
                "e.mean_travel_s AS mean_travel_s, e.stddev_s AS stddev_s"
            )
            edges: list[CameraEdge] = []
            for record in records:
                model = CameraEdgeModel(
                    from_camera=str(record["from_camera"]),
                    to_camera=str(record["to_camera"]),
                    mean_travel_s=float(record["mean_travel_s"]),
                    stddev_s=float(record["stddev_s"]),
                )
                edges.append(
                    CameraEdge(
                        from_camera=model.from_camera,
                        to_camera=model.to_camera,
                        mean_travel_s=model.mean_travel_s,
                        stddev_s=model.stddev_s,
                    )
                )
            return edges
    finally:
        driver.close()
