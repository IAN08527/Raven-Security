//! Topology prior, server side (M2-T3, D15, D16).
//!
//! Same mathematics as ``engine/topology.py``: the pipeline computes the
//! prior from ``camera_edges`` rows (read through the server, the sole
//! graph writer -- D10) and lowers the match threshold inside the expected
//! arrival window. The prior modulates the threshold; it never gates
//! execution. All timestamps are case-clock (D16); nothing here reads
//! system time.

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::reid::search::{TimeWindow, MAX_PRIOR_ADJUSTMENT};

/// One ``LEADS_TO`` edge's travel statistics. Serialised because
/// `POST /camera-edges` (API_CONTRACTS.md §2.6) creates these rows
/// through the server, the sole graph writer (D10); the prior only
/// ever reads them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CameraEdge {
    pub from_camera: Uuid,
    pub to_camera: Uuid,
    pub mean_travel_s: f64,
    pub stddev_s: f64,
}

/// Prior outcome for one candidate camera.
#[derive(Debug, Clone, PartialEq)]
pub struct TopologyPrior {
    pub expected_from: Option<Uuid>,
    pub expected_window: Option<TimeWindow>,
    pub prior_adjustment: f32,
}

/// Computes the prior for a candidate sighting given the last confirmed
/// sighting's camera and case-clock timestamp.
///
/// Window: ``last_ts + mean ± 2*stddev``. Inside: maximum reduction
/// (-0.15). No edge: 0.0 with no window. Outside a valid edge's window:
/// exponential decay toward 0.0, strictly between the two for finite
/// misses when ``stddev > 0``.
pub fn compute_prior(
    edges: &[CameraEdge],
    last_camera: Uuid,
    last_ts: OffsetDateTime,
    candidate_camera: Uuid,
    candidate_ts: OffsetDateTime,
) -> TopologyPrior {
    let Some(edge) = edges
        .iter()
        .find(|e| e.from_camera == last_camera && e.to_camera == candidate_camera)
    else {
        return TopologyPrior {
            expected_from: None,
            expected_window: None,
            prior_adjustment: 0.0,
        };
    };

    let window = TimeWindow {
        start: last_ts + time::Duration::seconds_f64(edge.mean_travel_s - 2.0 * edge.stddev_s),
        end: last_ts + time::Duration::seconds_f64(edge.mean_travel_s + 2.0 * edge.stddev_s),
    };
    if candidate_ts >= window.start && candidate_ts <= window.end {
        return TopologyPrior {
            expected_from: Some(last_camera),
            expected_window: Some(window),
            prior_adjustment: MAX_PRIOR_ADJUSTMENT,
        };
    }
    if edge.stddev_s <= 0.0 {
        return TopologyPrior {
            expected_from: Some(last_camera),
            expected_window: Some(window),
            prior_adjustment: 0.0,
        };
    }
    let half_width_s = 2.0 * edge.stddev_s;
    let centre = last_ts + time::Duration::seconds_f64(edge.mean_travel_s);
    let beyond_s = (candidate_ts - centre).abs().as_seconds_f64() - half_width_s;
    let adjustment = MAX_PRIOR_ADJUSTMENT * ((-beyond_s / half_width_s) as f32).exp();
    let clamped = adjustment.clamp(MAX_PRIOR_ADJUSTMENT, 0.0);
    // `exp` keeps finite misses strictly inside the open interval; guard
    // float edge cases without collapsing onto the endpoint.
    let clamped = if clamped <= MAX_PRIOR_ADJUSTMENT { MAX_PRIOR_ADJUSTMENT + f32::EPSILON } else { clamped };
    TopologyPrior {
        expected_from: Some(last_camera),
        expected_window: Some(window),
        prior_adjustment: clamped,
    }
}
