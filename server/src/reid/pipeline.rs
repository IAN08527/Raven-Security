//! Candidate pipeline (M2-T4, D9, D15, FR-5.8).
//!
//! On receiving ``cv.tracklet`` from the engine control socket:
//! 1. Retrieve active targets for this case (passed in -- persistence is
//!    the server's saga job; this module is pure decision logic).
//! 2. The engine already ran ``embed_tracklet``; the embedding arrives in
//!    the payload.
//! 3. Compute the topology prior for this camera and case-clock timestamp.
//! 4. Compare against each target above the prior-adjusted threshold.
//! 5. Each match becomes a ``status='proposed'`` candidate carrying its
//!    ``similarity``, ``threshold_used``, ``prior_adjustment``,
//!    ``expected_from``, ``expected_window`` and ``crop_path``, plus a
//!    ``reid.candidate`` socket event.
//! 6. No match above threshold: emit ``reid.lost`` -- never silently
//!    continue (FR-5.8).
//!
//! D9: nothing here confirms an identity. Proposals only; confirmation is
//! the decide endpoint's job and no other path constructs it.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::reid::search::{TimeWindow, adjusted_threshold, cosine_similarity};
use crate::reid::topology::{CameraEdge, compute_prior};

/// Operating threshold is explicit (S2 unmeasured -- CLAUDE.md rule 10):
/// the caller supplies the base bar, the prior lowers it per candidate.
#[derive(Debug, Clone)]
pub struct PipelineConfig {
    pub base_threshold: f32,
}

/// One completed tracklet as delivered on the control socket. ``ts`` and
/// ``embedding`` are case-clock data and engine output respectively; ``ts``
/// never comes from system time (D16).
#[derive(Debug, Clone)]
pub struct TrackletInput {
    pub case_id: Uuid,
    pub track_id: i64,
    pub camera_id: Uuid,
    pub ts: OffsetDateTime,
    pub embedding: Vec<f32>,
    pub bbox: [i32; 4],
    pub crop_path: Option<String>,
}

/// An active lock-on target for this case.
#[derive(Debug, Clone)]
pub struct ActiveTarget {
    pub target_id: Uuid,
    pub case_id: Uuid,
    pub embedding: Vec<f32>,
    pub source_camera: Uuid,
    pub source_ts: OffsetDateTime,
}

/// A proposal. ``threshold_used`` / ``prior_adjustment`` are non-optional:
/// the pipeline must not insert a row without them (API_CONTRACTS.md §4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProposedCandidate {
    pub target_id: Uuid,
    pub camera_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub ts: OffsetDateTime,
    pub similarity: f32,
    pub threshold_used: f32,
    pub prior_adjustment: f32,
    pub expected_from: Option<Uuid>,
    pub expected_window: Option<TimeWindow>,
    pub crop_path: Option<String>,
    pub status: DecisionStatus,
}

/// The only status this module ever constructs. ``Confirmed`` exists so
/// the decide endpoint (M2-T5) has a variant to transition into; pipeline
/// code paths that construct it are a D9 violation and are covered by a
/// test that fails if one appears outside the decide handler.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DecisionStatus {
    Proposed,
    Confirmed,
    Rejected,
}

/// ``reid.lost`` payload: the target was lost at a named camera (FR-5.8).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LostEvent {
    pub case_id: Uuid,
    pub camera_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen_ts: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PipelineOutcome {
    /// Camera is not registered: reject with a stated reason (rule 9),
    /// never silently drop.
    RejectedUnknownCamera { reason: String },
    Candidates(Vec<ProposedCandidate>),
    Lost(LostEvent),
}

/// Runs the six pipeline steps. Pure function of its inputs: no DB, no
/// socket, no clock reads -- the caller persists proposals and emits
/// events so they pass the audit emitter (D10).
pub fn handle_tracklet(
    config: &PipelineConfig,
    tracklet: &TrackletInput,
    registered_cameras: &HashSet<Uuid>,
    active_targets: &[ActiveTarget],
    edges: &[CameraEdge],
) -> PipelineOutcome {
    if !registered_cameras.contains(&tracklet.camera_id) {
        return PipelineOutcome::RejectedUnknownCamera {
            reason: format!(
                "camera {} is not registered; tracklet {} rejected",
                tracklet.camera_id, tracklet.track_id
            ),
        };
    }

    let mut proposals = Vec::new();
    for target in active_targets.iter().filter(|t| t.case_id == tracklet.case_id) {
        let Ok(similarity) = cosine_similarity(&target.embedding, &tracklet.embedding) else {
            continue;
        };
        let prior = compute_prior(
            edges,
            target.source_camera,
            target.source_ts,
            tracklet.camera_id,
            tracklet.ts,
        );
        let Ok(threshold) = adjusted_threshold(config.base_threshold, prior.prior_adjustment)
        else {
            continue;
        };
        if similarity > threshold {
            proposals.push(ProposedCandidate {
                target_id: target.target_id,
                camera_id: tracklet.camera_id,
                ts: tracklet.ts,
                similarity,
                threshold_used: threshold,
                prior_adjustment: prior.prior_adjustment,
                expected_from: prior.expected_from,
                expected_window: prior.expected_window,
                crop_path: tracklet.crop_path.clone(),
                status: DecisionStatus::Proposed,
            });
        }
    }

    if proposals.is_empty() {
        PipelineOutcome::Lost(LostEvent {
            case_id: tracklet.case_id,
            camera_id: tracklet.camera_id,
            last_seen_ts: tracklet.ts,
        })
    } else {
        PipelineOutcome::Candidates(proposals)
    }
}

/// Builds the ``reid.candidate`` socket event for one proposal
/// (API_CONTRACTS.md §1.2 envelope). ``socket_ts`` is wall-clock socket
/// ordering; the sighting's own ``case_clock_ts`` is case-clock (D16).
pub fn build_reid_candidate_event(
    proposal: &ProposedCandidate,
    socket_ts: OffsetDateTime,
) -> serde_json::Value {
    serde_json::json!({
        "v": 1,
        "type": "reid.candidate",
        "ts": socket_ts.format(&time::format_description::well_known::Rfc3339).unwrap_or_default(),
        "case_clock_ts": proposal.ts.format(&time::format_description::well_known::Rfc3339).unwrap_or_default(),
        "trace_id": ulid::Ulid::new().to_string(),
        "payload": {
            "target_id": proposal.target_id,
            "camera_id": proposal.camera_id,
            "similarity": proposal.similarity,
            "threshold_used": proposal.threshold_used,
            "prior_adjustment": proposal.prior_adjustment,
            "expected_from": proposal.expected_from,
            "expected_window": proposal.expected_window,
            "crop_path": proposal.crop_path,
            "status": "proposed",
        }
    })
}

/// Builds the ``reid.lost`` socket event (FR-5.8). Same clock split as above.
pub fn build_reid_lost_event(lost: &LostEvent, socket_ts: OffsetDateTime) -> serde_json::Value {
    serde_json::json!({
        "v": 1,
        "type": "reid.lost",
        "ts": socket_ts.format(&time::format_description::well_known::Rfc3339).unwrap_or_default(),
        "case_clock_ts": lost.last_seen_ts.format(&time::format_description::well_known::Rfc3339).unwrap_or_default(),
        "trace_id": ulid::Ulid::new().to_string(),
        "payload": {
            "case_id": lost.case_id,
            "camera_id": lost.camera_id,
            "last_seen_ts": lost.last_seen_ts.format(&time::format_description::well_known::Rfc3339).unwrap_or_default(),
        }
    })
}

/// Groups proposals per target for the review panel.
#[allow(dead_code)]
pub fn group_by_target(
    proposals: Vec<ProposedCandidate>,
) -> HashMap<Uuid, Vec<ProposedCandidate>> {
    let mut grouped: HashMap<Uuid, Vec<ProposedCandidate>> = HashMap::new();
    for proposal in proposals {
        grouped.entry(proposal.target_id).or_default().push(proposal);
    }
    grouped
}
