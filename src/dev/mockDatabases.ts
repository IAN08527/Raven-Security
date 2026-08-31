/**
 * Mock data + simulated ingest pipeline for the Databases module.
 *
 * The real Raven engine exposes Postgres/Neo4j/Storage/Ledger health over the
 * Tauri command bridge + Python engine (`useInvoke`). Until those routes exist
 * for the Databases view, this module drives the UI with deterministic mock
 * data so `npm run dev` renders a populated, demo-ready module (team-leader
 * decision: "for testing we will need mock data").
 */

export type StoreKind = "postgres" | "graph" | "storage" | "ledger";
export type HealthState = "up" | "degraded" | "down";

export interface ConnectedStore {
  id: string;
  name: string;
  kind: StoreKind;
  role: string;
  location: string;
  health: HealthState;
  /** 0..100 — share of integrity checks currently passing. */
  integrity: number;
  records: number;
  recordLabel: string;
  lastSync: string;
}

/** The four data stores Raven already runs (see CONTEXT.md architecture). */
export const CONNECTED_STORES: ConnectedStore[] = [
  {
    id: "supabase-pg",
    name: "Supabase Postgres",
    kind: "postgres",
    role: "Primary relational store",
    location: "cloud · ap-south-1",
    health: "up",
    integrity: 100,
    records: 4821,
    recordLabel: "rows · 19 tables",
    lastSync: "just now",
  },
  {
    id: "neo4j",
    name: "Neo4j Graph",
    kind: "graph",
    role: "Criminal-network graph",
    location: "local · docker :7687",
    health: "up",
    integrity: 98,
    records: 342,
    recordLabel: "nodes · 561 rels",
    lastSync: "12s ago",
  },
  {
    id: "supabase-storage",
    name: "Supabase Storage",
    kind: "storage",
    role: "Evidence blob bucket",
    location: "cloud · bucket: evidence",
    health: "up",
    integrity: 100,
    records: 87,
    recordLabel: "blobs",
    lastSync: "1m ago",
  },
  {
    id: "fabric-ledger",
    name: "Fabric Ledger",
    kind: "ledger",
    role: "Tamper-proof audit anchors",
    location: "local · mock fallback",
    health: "degraded",
    integrity: 76,
    records: 87,
    recordLabel: "anchors · 21 pending",
    lastSync: "4m ago",
  },
];

export interface IntegrityCheck {
  storeId: string;
  label: string;
  state: "pass" | "warn" | "fail";
  detail: string;
}

/** Per-store data-integrity checks surfaced under each store. */
export const INTEGRITY_CHECKS: IntegrityCheck[] = [
  { storeId: "supabase-pg", label: "Schema present (19/19 tables)", state: "pass", detail: "All migration tables found" },
  { storeId: "supabase-pg", label: "Foreign-key orphans", state: "pass", detail: "0 orphaned rows" },
  { storeId: "supabase-pg", label: "source_files ↔ Storage blob parity", state: "pass", detail: "87 / 87 matched" },
  { storeId: "neo4j", label: "Entity ↔ Postgres id sync", state: "warn", detail: "6 entities pending merge" },
  { storeId: "neo4j", label: "Relationship weight recompute", state: "pass", detail: "561 edges consistent" },
  { storeId: "supabase-storage", label: "Blob SHA-256 round-trip", state: "pass", detail: "sampled 20 / 20 OK" },
  { storeId: "fabric-ledger", label: "Anchor coverage", state: "warn", detail: "21 documents unanchored" },
  { storeId: "fabric-ledger", label: "Gateway reachable", state: "fail", detail: "peer down — mock fallback active" },
];

export interface DataCategory {
  id: string;
  label: string;
  /** Real schema source_node this maps into. */
  source: string;
  /** Target Postgres table the ingest pipeline routes rows into. */
  target: string;
  hint: string;
}

/**
 * Predefined categories a newly connected DB (or uploaded file) is tagged with.
 * Grounded in the real `source_node` enum + target tables from
 * infra/migrations/001_init.sql.
 */
export const DATA_CATEGORIES: DataCategory[] = [
  { id: "financial", label: "Financial", source: "CFCFRMS", target: "financial_txns", hint: "Bank / UPI / hawala transactions" },
  { id: "vehicle", label: "Vehicle", source: "VAHAN", target: "entities · identifiers", hint: "Registrations, RC, owners" },
  { id: "telecom", label: "Telecom / CDR", source: "TELECOM", target: "cdr_records", hint: "Call detail records, tower pings" },
  { id: "identity", label: "Identity / Biometric", source: "NAFIS", target: "entities · identifiers", hint: "Aadhaar, fingerprints, faces" },
  { id: "case", label: "Case / FIR", source: "CCTNS", target: "source_files · cases", hint: "FIRs, chargesheets, ICJS records" },
  { id: "location", label: "Location", source: "MANUAL", target: "location_history", hint: "GPS, address history, hotspots" },
  { id: "other", label: "Other / Unclassified", source: "MANUAL", target: "isolated", hint: "Isolated until schema is mapped" },
];

export interface PipelineStage {
  id: string;
  label: string;
  detail: string;
}

/** The data-upload pipeline stages ("store all in sequence"). */
export const PIPELINE_STAGES: PipelineStage[] = [
  { id: "hash", label: "Hash & register", detail: "SHA-256 stream · source_files row" },
  { id: "parse", label: "Parse & extract", detail: "CSV columns / PDF OCR + NER" },
  { id: "map", label: "Map to schema", detail: "Match fields to target table" },
  { id: "store", label: "Store rows", detail: "Insert into Postgres + Storage blob" },
  { id: "isolate", label: "Isolate unmapped", detail: "Park unknown fields for review" },
  { id: "commit", label: "Commit & anchor", detail: "Ledger anchor + audit emit" },
];

/** A field the pipeline could not map to the existing schema. */
export interface UnmappedField {
  column: string;
  sample: string;
}

export interface PipelineResult {
  fileName: string;
  category: string;
  rowsDetected: number;
  rowsMapped: number;
  rowsIsolated: number;
  unmapped: UnmappedField[];
}

/**
 * Deterministically simulate what the ingest pipeline would do with an
 * uploaded file, given its name + chosen category. Pure/synchronous; the pane
 * animates the stages around it.
 */
export function simulateIngest(fileName: string, categoryId: string): PipelineResult {
  const isPdf = /\.pdf$/i.test(fileName);
  const base = (fileName.length * 7) % 40;
  const rowsDetected = isPdf ? 1 : 120 + base;

  // "Other" is fully isolated; known categories map most rows and isolate a few
  // unknown columns to demonstrate the isolation path the leader described.
  const unmappedByCategory: Record<string, UnmappedField[]> = {
    financial: [{ column: "beneficiary_pan", sample: "ABCDE1234F" }, { column: "gst_ref", sample: "27AAAA0000A1Z5" }],
    vehicle: [{ column: "insurance_expiry", sample: "2027-03-11" }],
    telecom: [{ column: "roaming_flag", sample: "true" }],
    identity: [{ column: "iris_hash", sample: "9f2a…c1" }],
    case: [{ column: "annexure_count", sample: "3" }],
    location: [{ column: "altitude_m", sample: "14.2" }],
    other: [{ column: "*", sample: "entire file held for review" }],
  };

  const unmapped = unmappedByCategory[categoryId] ?? [];
  const rowsIsolated = categoryId === "other" ? rowsDetected : Math.min(unmapped.length, rowsDetected);
  const rowsMapped = Math.max(0, rowsDetected - rowsIsolated);

  return {
    fileName,
    category: categoryId,
    rowsDetected,
    rowsMapped,
    rowsIsolated,
    unmapped,
  };
}
