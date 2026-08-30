// Deterministic offline graph used when neither the Tauri shell nor the Python
// engine is reachable (e.g. `npm run dev` on a machine with no backend). Lets
// the UI be exercised end-to-end for rehearsal. Mirrors the live shapes.

import type {
  EgoGraph,
  EdgeEvidence,
  EntityDetails,
  GraphNode,
  GraphEdge,
} from "../types/generated";

type AnyRecord = Record<string, unknown>;

interface MockNode extends GraphNode {}
interface MockEdge extends GraphEdge {}

const NODES: MockNode[] = [
  { id: "n_rakesh", label: "Rakesh Sawant", type: "PERSON", risk_score: 0.92, degree: 0 },
  { id: "n_suresh", label: "Suresh Patil", type: "PERSON", risk_score: 0.71, degree: 0 },
  { id: "n_vijay", label: "Vijay Deshmukh", type: "PERSON", risk_score: 0.66, degree: 0 },
  { id: "n_sanjay", label: "Sanjay Jadhav", type: "PERSON", risk_score: 0.58, degree: 0 },
  { id: "n_deepak", label: "Deepak Gaikwad", type: "PERSON", risk_score: 0.58, degree: 0 },
  { id: "n_rahul", label: "Rahul More", type: "PERSON", risk_score: 0.39, degree: 0 },
  { id: "n_quickpay", label: "M/s QuickPay Solutions Pvt Ltd", type: "ORGANIZATION", risk_score: 0.0, degree: 0 },
  { id: "n_skyline", label: "Skyline Cargo LLP", type: "ORGANIZATION", risk_score: 0.0, degree: 0 },
  { id: "n_mh01", label: "MH01AB1234", type: "VEHICLE", risk_score: 0.0, degree: 0 },
  { id: "n_mh12", label: "MH12XY9988", type: "VEHICLE", risk_score: 0.0, degree: 0 },
  { id: "n_icici", label: "ICICI 00245678901", type: "ACCOUNT", risk_score: 0.0, degree: 0 },
  { id: "n_sbi", label: "SBI 37890123456", type: "ACCOUNT", risk_score: 0.0, degree: 0 },
  { id: "n_dadar", label: "Dadar East", type: "LOCATION", risk_score: 0.0, degree: 0 },
  { id: "n_sakinaka", label: "Sakinaka Junction", type: "LOCATION", risk_score: 0.0, degree: 0 },
];

const EDGES: MockEdge[] = [
  { id: "e1", source: "n_rakesh", target: "n_suresh", type: "CO_ACCUSED", weight: 125, evidence_count: 1, dominant_kind: "fir_text" },
  { id: "e2", source: "n_rakesh", target: "n_vijay", type: "CO_ACCUSED", weight: 125, evidence_count: 1, dominant_kind: "fir_text" },
  { id: "e3", source: "n_suresh", target: "n_sanjay", type: "CO_ACCUSED", weight: 125, evidence_count: 1, dominant_kind: "fir_text" },
  { id: "e4", source: "n_rakesh", target: "n_suresh", type: "CALLED", weight: 50, evidence_count: 1, dominant_kind: "cdr_row" },
  { id: "e5", source: "n_suresh", target: "n_vijay", type: "CALLED", weight: 30, evidence_count: 1, dominant_kind: "cdr_row" },
  { id: "e6", source: "n_vijay", target: "n_rahul", type: "CALLED", weight: 20, evidence_count: 1, dominant_kind: "cdr_row" },
  { id: "e7", source: "n_icici", target: "n_sbi", type: "TRANSFERRED_TO", weight: 50, evidence_count: 1, dominant_kind: "txn_row" },
  { id: "e8", source: "n_icici", target: "n_quickpay", type: "TRANSFERRED_TO", weight: 50, evidence_count: 1, dominant_kind: "txn_row" },
  { id: "e9", source: "n_rakesh", target: "n_deepak", type: "SEEN_WITH", weight: 50, evidence_count: 1, dominant_kind: "cctv_sighting" },
  { id: "e10", source: "n_suresh", target: "n_mh01", type: "SEEN_WITH", weight: 50, evidence_count: 1, dominant_kind: "cctv_sighting" },
  { id: "e11", source: "n_vijay", target: "n_mh12", type: "SEEN_WITH", weight: 50, evidence_count: 1, dominant_kind: "cctv_sighting" },
  { id: "e12", source: "n_rakesh", target: "n_quickpay", type: "CO_LOCATED", weight: 50, evidence_count: 1, dominant_kind: "cdr_row" },
  { id: "e13", source: "n_deepak", target: "n_rakesh", type: "RESIDES_WITH", weight: 125, evidence_count: 1, dominant_kind: "fir_text" },
  { id: "e14", source: "n_rahul", target: "n_sakinaka", type: "CO_LOCATED", weight: 50, evidence_count: 1, dominant_kind: "cdr_row" },
  { id: "e15", source: "n_rakesh", target: "n_mh01", type: "SEEN_WITH", weight: 50, evidence_count: 1, dominant_kind: "cctv_sighting" },
  { id: "e16", source: "n_deepak", target: "n_icici", type: "CO_LOCATED", weight: 50, evidence_count: 1, dominant_kind: "txn_row" },
];

function withDegree(nodes: MockNode[], edges: MockEdge[]): MockNode[] {
  const deg: Record<string, number> = {};
  for (const e of edges) {
    deg[e.source] = (deg[e.source] ?? 0) + 1;
    deg[e.target] = (deg[e.target] ?? 0) + 1;
  }
  return nodes.map((n) => ({ ...n, degree: deg[n.id] ?? 0 }));
}

function macro(minWeight: number, limit: number): EgoGraph {
  const edges = EDGES.filter((e) => e.weight >= minWeight).slice(0, limit);
  const ids = new Set<string>();
  edges.forEach((e) => {
    ids.add(e.source);
    ids.add(e.target);
  });
  const nodes = withDegree(
    NODES.filter((n) => ids.has(n.id)),
    edges,
  );
  return { nodes, edges, source: "mock", case_id: "OP-RAVEN-01" };
}

function ego(entityId: string, hops: number, minWeight: number): EgoGraph {
  const visited = new Set<string>([entityId]);
  let frontier = new Set<string>([entityId]);
  for (let h = 0; h < hops; h++) {
    const next = new Set<string>();
    for (const e of EDGES) {
      if (e.weight < minWeight) continue;
      if (frontier.has(e.source) && !visited.has(e.target)) next.add(e.target);
      if (frontier.has(e.target) && !visited.has(e.source)) next.add(e.source);
    }
    next.forEach((id) => visited.add(id));
    frontier = next;
  }
  const edges = EDGES.filter(
    (e) =>
      e.weight >= minWeight &&
      visited.has(e.source) &&
      visited.has(e.target),
  );
  const nodes = withDegree(
    NODES.filter((n) => visited.has(n.id)),
    edges,
  );
  return { nodes, edges, source: "mock", case_id: "OP-RAVEN-01" };
}

function edgeEvidence(relId: string): EdgeEvidence {
  const e = EDGES.find((x) => x.id === relId);
  if (!e) {
    return { relationship: null, evidence: [], source_files: [] };
  }
  return {
    relationship: {
      id: e.id,
      type: e.type,
      weight: e.weight,
      evidence_count: e.evidence_count,
      src_id: e.source,
      src_name: NODES.find((n) => n.id === e.source)?.label ?? e.source,
      dst_id: e.target,
      dst_name: NODES.find((n) => n.id === e.target)?.label ?? e.target,
    },
    evidence: [
      {
        id: 1,
        kind: e.dominant_kind ?? "fir_text",
        snippet: `${NODES.find((n) => n.id === e.source)?.label} and ${NODES.find((n) => n.id === e.target)?.label} linked by ${e.type} (mock evidence).`,
        char_start: 0,
        char_end: 64,
        page_no: 1,
        source_file_id: "sf_mock",
      },
    ],
    source_files: [
      { id: "sf_mock", filename: "mock/demo_network.txt", sha256: "0".repeat(64), status: "committed" },
    ],
  };
}

function entityDetails(entityId: string): EntityDetails {
  const n = NODES.find((x) => x.id === entityId);
  return {
    entity: n ?? { id: entityId, label: entityId, type: "PERSON", risk_score: 0, degree: 0 },
    identifiers: [
      { itype: "PHONE", value: "+91-98200-11223" },
      { itype: "NAFIS", value: "NAFIS-0001" },
    ],
    evidence: [
      {
        id: 1,
        kind: "fir_text",
        snippet: "Mock entity evidence for UI rehearsal.",
        char_start: 0,
        char_end: 40,
        page_no: 1,
        source_file_id: "sf_mock",
      },
    ],
    linked_files: [
      { id: "sf_mock", filename: "mock/demo_network.txt", sha256: "0".repeat(64), status: "committed" },
    ],
  };
}

export function mockInvoke<T>(cmd: string, args?: AnyRecord): T {
  if (cmd === "health_check") {
    return {
      supabase: "up",
      neo4j: "mock",
      ollama: "mock",
      fabric: "mock",
      python: "up",
      vram_free_mb: 8192,
    } as unknown as T;
  }
  switch (cmd) {
    case "get_macro_graph":
      return macro(Number(args?.min_weight ?? 5), Number(args?.limit ?? 1000)) as unknown as T;
    case "get_ego_graph":
      return ego(String(args?.entity_id ?? "n_rakesh"), Number(args?.hops ?? 2), Number(args?.min_weight ?? 5)) as unknown as T;
    case "get_edge_evidence":
      return edgeEvidence(String(args?.rel_id)) as unknown as T;
    case "get_entity_details":
      return entityDetails(String(args?.entity_id)) as unknown as T;
    case "list_entities":
      return NODES as unknown as T;
    default:
      throw new Error(`mock: unknown command ${cmd}`);
  }
}
