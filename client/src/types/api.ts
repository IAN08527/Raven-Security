// Types generated from Rust structs via cargo xtask generate-types.
// Generated files live in types/generated/ (gitignored).
// To regenerate: cargo xtask generate-types
// Client-only types (UI state, component props) remain below.

// --- Generated re-exports (Rust is the source of truth, D30) ---

export type { AppRole } from "./generated/AppRole";
export type { AuditRow } from "./generated/AuditRow";
export type { Camera } from "./generated/Camera";
export type { CameraEdge } from "./generated/CameraEdge";
export type { Candidate } from "./generated/Candidate";
export type { CandidateMatch } from "./generated/CandidateMatch";
export type { AssignmentEntry } from "./generated/AssignmentEntry";
export type { CaseDetailResponse } from "./generated/CaseDetailResponse";
export type { CaseHit } from "./generated/CaseHit";
export type { CaseRecord } from "./generated/CaseRecord";
export type { CreateCaseRequest } from "./generated/CreateCaseRequest";
export type { Clock } from "./generated/Clock";
export type { CreateEdgeRequest } from "./generated/CreateEdgeRequest";
export type { CreateNoteRequest } from "./generated/CreateNoteRequest";
export type { CreateTargetRequest } from "./generated/CreateTargetRequest";
export type { CreateTargetResponse } from "./generated/CreateTargetResponse";
export type { CreateUserRequest } from "./generated/CreateUserRequest";
export type { DeactivateUserRequest } from "./generated/DeactivateUserRequest";
export type { DecideDecision } from "./generated/DecideDecision";
export type { DecideMergeRequest } from "./generated/DecideMergeRequest";
export type { DecideMergeResponse } from "./generated/DecideMergeResponse";
export type { DecideRequest } from "./generated/DecideRequest";
export type { DecideResponse } from "./generated/DecideResponse";
export type { DecideReviewRequest } from "./generated/DecideReviewRequest";
export type { DecideReviewResponse } from "./generated/DecideReviewResponse";
export type { DecisionStatus } from "./generated/DecisionStatus";
export type { DecisionStatus as CandidateStatus } from "./generated/DecisionStatus";
export type { DependencyStatus } from "./generated/DependencyStatus";
export type { Endorsement } from "./generated/Endorsement";
export type { Entity } from "./generated/Entity";
export type { EntityDetailResponse as EntityDetail } from "./generated/EntityDetailResponse";
export type { EntityHit } from "./generated/EntityHit";
export type { EntityListItem } from "./generated/EntityListItem";
export type { EntityNote } from "./generated/EntityNote";
export type { EntityType } from "./generated/EntityType";
export type { EntityType as GraphEntityType } from "./generated/EntityType";
export type { ErrorBody } from "./generated/ErrorBody";
export type { ErrorEnvelope } from "./generated/ErrorEnvelope";
export type { EvidenceItem as EdgeEvidenceItem } from "./generated/EvidenceItem";
export type { FileDetailResponse } from "./generated/FileDetailResponse";
export type { FileHit } from "./generated/FileHit";
export type { FileRecord } from "./generated/FileRecord";
export type { GraphEdge } from "./generated/GraphEdge";
export type { GraphNode } from "./generated/GraphNode";
export type { GraphPayload } from "./generated/GraphPayload";
export type { HealthReport } from "./generated/HealthReport";
export type { IdentifierHit } from "./generated/IdentifierHit";
export type { IngestJob } from "./generated/IngestJob";
export type { ListEntitiesResponse as EntityListResponse } from "./generated/ListEntitiesResponse";
export type { LostEvent as ReidLostPayload } from "./generated/LostEvent";
export type { MergeProposal } from "./generated/MergeProposal";
export type { MergeStatus } from "./generated/MergeStatus";
export type { MovementPoint } from "./generated/MovementPoint";
export type { MovementTimelineResponse as MovementTimeline } from "./generated/MovementTimelineResponse";
export type { Node } from "./generated/Node";
export type { Node as EngineNode } from "./generated/Node";
export type { ProposedCandidate } from "./generated/ProposedCandidate";
export type { PreviewExtractionRequest } from "./generated/PreviewExtractionRequest";
export type { PreviewSpan } from "./generated/PreviewSpan";
export type { PreviewSurface } from "./generated/PreviewSurface";
export type { ProposeMergeRequest } from "./generated/ProposeMergeRequest";
export type { ProposeMergeResponse } from "./generated/ProposeMergeResponse";
export type { RegisterCameraRequest } from "./generated/RegisterCameraRequest";
export type { RegisterNodeRequest } from "./generated/RegisterNodeRequest";
export type { ReviewItem } from "./generated/ReviewItem";
export type { ReviewStatus } from "./generated/ReviewStatus";
export type { RoutineCluster } from "./generated/RoutineCluster";
export type { RoutineResponse } from "./generated/RoutineResponse";
export type { SearchResponse } from "./generated/SearchResponse";
export type { SyncState } from "./generated/SyncState";
export type { TamperState } from "./generated/TamperState";
export type { Target } from "./generated/Target";
export type { TerminalStatus } from "./generated/TerminalStatus";
export type { TimelineEvent } from "./generated/TimelineEvent";
export type { TimelineResponse as CaseTimeline } from "./generated/TimelineResponse";
export type { TimeWindow as ExpectedWindow } from "./generated/TimeWindow";
export type { UserRecord as AdminUser } from "./generated/UserRecord";
export type { VerifyFileResponse } from "./generated/VerifyFileResponse";
export type { VerifyRowResponse } from "./generated/VerifyRowResponse";
export type { VerifyStatus } from "./generated/VerifyStatus";
export type { JsonValue } from "./generated/serde_json/JsonValue";

// Local bindings for the client-only types below. (A bare
// `export ... from` re-exports without declaring a local name.)
import type { Candidate } from "./generated/Candidate";
import type { DecisionStatus as CandidateStatus } from "./generated/DecisionStatus";
import type { EntityDetailResponse as EntityDetail } from "./generated/EntityDetailResponse";
import type { LostEvent as ReidLostPayload } from "./generated/LostEvent";
import type { TimeWindow as ExpectedWindow } from "./generated/TimeWindow";

// Alias kept so existing §2.5 call sites read naturally; one shape,
// one owner (EntityDetail above, re-exported from generated/).
export type EntityRecord = EntityDetail;

// --- Client-only types below ---
//
// These have no Rust counterpart: engine-socket payloads (the client
// talks to engine nodes directly per API_CONTRACTS.md §3, a boundary
// the server's ts-rs registry does not cover), the CameraView
// contract-target view model, and UI state. If the server ever serves
// one of these shapes, delete the local copy and re-export instead.

// API_CONTRACTS.md §2.6 does not enumerate `status`'s values explicitly.
// "online" / "offline" / "degraded" mirror D14's node-degraded language and
// the CCTV status-indicator vocabulary in the design system (§3.3, §10.5).
export type CameraStatus = "online" | "offline" | "degraded";

export type CameraMode = "live" | "recorded";

// Client-assembled §2.6 view model, NOT the wire type (see `Camera`
// above, the generated M1-T1 stub shape). The stub `GET /cameras`
// carries no coordinates, mode, status, node or stream URL yet
// (main.tsx documents the gap); the video wall needs the contracted
// shape, so callers assemble it from the wire Camera plus engine-node
// status (HomeDashboard-style), never by fetching it. When the server
// serves the full §2.6 shape, delete this and use generated `Camera`.
export interface CameraView {
  id: string;
  code: string;
  label: string;
  lat: number | null;
  lon: number | null;
  mode: CameraMode;
  declared_start_ts: string; // RFC 3339, case clock (D16)
  fps: number;
  effective_fps: number | null;
  status: CameraStatus;
  node_id: string | null;
  // Null/absent, or `status !== "online"`, means the engine node is not
  // currently serving this feed -- CameraFeed shows the unavailable
  // placeholder rather than attempting to load a stream.
  stream_url: string | null;
}

export interface Box {
  track_id: number | null;
  bbox: [number, number, number, number]; // x, y, w, h in native frame pixels
  conf: number;
  is_target: boolean;
}

export interface CvBoxesPayload {
  camera_code: string;
  frame_seq: number;
  effective_fps: number;
  below_quality_floor: boolean;
  boxes: Box[];
}

export interface EventEnvelope<Type extends string, Payload> {
  v: 1;
  type: Type;
  ts: string;
  case_clock_ts: string | null;
  trace_id: string;
  payload: Payload;
}

export type CvBoxesEvent = EventEnvelope<"cv.boxes", CvBoxesPayload>;

// Engine-socket candidate: the generated `Candidate` wire base plus the
// expected arrival window the engine delivers on its control socket
// (API_CONTRACTS.md §4). `status` reuses the generated DecisionStatus
// values via CandidateStatus above.
export interface ReidCandidate extends Candidate {
  expected_window: ExpectedWindow | null;
}

export interface ReidCandidatePayload {
  target_id: string;
  camera_id: string;
  similarity: number;
  threshold_used: number;
  prior_adjustment: number;
  expected_from: string | null;
  expected_window: ExpectedWindow | null;
  crop_path: string | null;
  status: CandidateStatus;
}

export type ReidCandidateEvent = EventEnvelope<"reid.candidate", ReidCandidatePayload>;
export type ReidLostEvent = EventEnvelope<"reid.lost", ReidLostPayload>;
