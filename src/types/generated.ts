export interface HealthStatus {
  supabase: string;
  neo4j: string;
  ollama: string;
  fabric: string;
  python: string;
  vram_free_mb: number;
}

export interface EgoGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  source: string;
  case_id: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  risk_score: number;
  degree: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  weight: number;
  evidence_count: number;
  dominant_kind: string | null;
}

export interface IngestResult {
  job_id: number;
  file_id: string;
}

export interface IngestStatus {
  stage: string;
  status: string;
  error_detail: string | null;
}

export interface RelationshipMeta {
  id: string;
  type: string;
  weight: number;
  evidence_count: number;
  src_id: string;
  src_name: string;
  dst_id: string;
  dst_name: string;
}

export interface Identifier {
  itype: string;
  value: string;
}

export interface EdgeEvidence {
  relationship: RelationshipMeta | null;
  evidence: Evidence[];
  source_files: SourceFile[];
}

export interface EntityDetails {
  entity: GraphNode;
  identifiers: Identifier[];
  evidence: Evidence[];
  linked_files: SourceFile[];
}

export interface Evidence {
  id: number;
  snippet: string | null;
  char_start: number | null;
  char_end: number | null;
  page_no: number | null;
  kind: string;
  source_file_id: string;
}

export interface SourceFile {
  id: string;
  filename: string;
  sha256: string;
  status: string;
}

export interface AuditEntry {
  id: number;
  event_type: string;
  actor: string;
  target_id: string | null;
  target_type: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface VerifyResult {
  matched: boolean;
  local_sha: string;
  chain_sha: string;
  tx_id: string;
  anchored_at: string;
}

export interface RoutineResult {
  points: { lat: number; lon: number; ts: string }[];
  hotspots: unknown[];
  loop: unknown[];
}

export interface TrackingResult {
  session_id: string;
  stream_url: string;
  ws_url: string;
}

export interface LockResult {
  target_id: string;
  tx_id: string;
  ledger_status: string;
}

export interface ConfirmResult {
  review_id: number;
  tx_id: string;
  ledger_status: string;
  edges_bumped: number;
  evidence_written: number;
}

export interface CVBox {
  track_id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
}

export interface CVDetections {
  camera_code: string;
  boxes: CVBox[];
  frame_w?: number;
  frame_h?: number;
}

export interface CVSighting {
  sighting_id: number | null;
  target_id: string;
  camera_code: string;
  similarity: number;
  bbox: number[];
  frame_path: string;
  ts: string;
  track_id?: number;
}

export type WebSocketEvent =
  | { v: number; type: string; ts: string; payload: Record<string, unknown> };
