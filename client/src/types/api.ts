// TEMPORARY: hand-written types, see DECISIONS.md D30.
// Do not treat this file as generated. Keep in sync with
// server Rust structs manually until ts-rs is added.
//
// Shared shapes for the client<->server and client<->engine-node
// boundaries (API_CONTRACTS.md §1.2, §2.6, §3.2).

export type CameraMode = "live" | "recorded";

// API_CONTRACTS.md §2.6 does not enumerate `status`'s values explicitly.
// "online" / "offline" / "degraded" mirror D14's node-degraded language and
// the CCTV status-indicator vocabulary in the design system (§3.3, §10.5).
export type CameraStatus = "online" | "offline" | "degraded";

export interface Camera {
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

// M2-T4/M2-T5. Re-ID candidate flow (API_CONTRACTS.md §2.6, §4). Every
// candidate carries threshold_used and prior_adjustment: a candidate
// without them is invalid (§4 rule 4) and the DB enforces NOT NULL.
export type CandidateStatus = "proposed" | "confirmed" | "rejected";

export interface ExpectedWindow {
  start: string; // RFC 3339, case clock (D16)
  end: string; // RFC 3339, case clock (D16)
}

export interface ReidCandidate {
  id: number;
  target_id: string;
  camera_id: string;
  ts: string; // case_clock_ts of the sighting (D16)
  similarity: number;
  threshold_used: number;
  prior_adjustment: number;
  expected_from: string | null;
  expected_window: ExpectedWindow | null;
  crop_path: string | null;
  status: CandidateStatus;
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

export interface ReidLostPayload {
  case_id: string;
  camera_id: string;
  last_seen_ts: string; // case clock (D16)
}

export type ReidCandidateEvent = EventEnvelope<"reid.candidate", ReidCandidatePayload>;
export type ReidLostEvent = EventEnvelope<"reid.lost", ReidLostPayload>;

// M4-T3/M4-T5. Graph analytics (API_CONTRACTS.md §2.4, D23, FR-4).
// `types` defaults to person-only server-side; the client repeats the
// default explicitly rather than relying on it.
export type GraphEntityType = "PERSON" | "ORGANIZATION" | "ACCOUNT" | "LOCATION" | "VEHICLE";

export interface GraphNode {
  id: string;
  type: GraphEntityType;
  label: string;
}

export interface GraphEdge {
  id: string;
  src: string;
  dst: string;
  type: string;
  weight: number;
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type TamperState = "verified" | "pending" | "tampered";

export interface EdgeEvidenceItem {
  id: number;
  kind: string;
  snippet: string | null;
  char_start: number | null;
  char_end: number | null;
  page_no: number | null;
  source_file_id: string;
  provenance: string;
  tamper_state: TamperState;
  occurred_at: string | null; // case clock (D16)
  ledger_hash: string | null; // FR-7.2: both hashes shown on tampered rows
  computed_hash: string | null;
}

export interface GraphIdentifier {
  type: string;
  value: string;
}

export interface EntityDetail {
  id: string;
  case_id: string;
  type: GraphEntityType;
  canonical_name: string;
  aliases: string[];
  identifiers: string[];
  relationships: string[];
  associated_cases: string[];
  case_count: number;
  provenance: string;
  sync_state: string;
  notes: EntityNote[];
}

// Alias kept so existing §2.5 call sites read naturally; one shape,
// one owner (EntityDetail above).
export type EntityRecord = EntityDetail;

// API_CONTRACTS.md §2.5 entity listing and detail (server/src/api/entities.rs).
// `EntityDetail` above stays as the graph projection's shape; the shapes
// below are the entities endpoints' contract (associated cases, provenance,
// sync state, embedded notes). No risk score: PRD §5 excludes risk scoring
// of individuals, recorded in the contract.

export interface EntityListItem {
  id: string;
  type: GraphEntityType;
  canonical_name: string;
  identifiers: string[];
  case_count: number;
  provenance: string;
  sync_state: string;
}

export interface EntityListResponse {
  results: EntityListItem[];
  next_cursor: string | null;
}

export interface EntityNote {
  id: string;
  entity_id: string;
  text: string;
  created_by: string;
  created_at: string; // mirrors the annotation's audit row (server-side)
}
