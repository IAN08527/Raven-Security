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

/** A CSV header that was matched to a real target-table column. */
export interface MappedField {
  header: string;
  target: string;
}

export interface PipelineResult {
  fileName: string;
  category: string;
  kind: "csv" | "pdf";
  rowsDetected: number;
  /** csv: count of mapped columns · pdf: count of mapped rows */
  mappedCount: number;
  /** csv: count of unmapped columns · pdf: count of isolated rows */
  isolatedCount: number;
  mappedFields: MappedField[];
  unmapped: UnmappedField[];
}

/**
 * Accepted CSV headers per category, mapped to the real target-table column
 * they land in. Column names come from infra/migrations/001_init.sql; the alias
 * lists let common CSV spellings (amount_inr, date, method…) match. Headers not
 * listed here are isolated for human review.
 */
const SCHEMA_FIELDS: Record<string, Record<string, string[]>> = {
  // financial_txns
  financial: {
    from_account: ["from_account", "fromaccount", "sender", "debit_account", "from"],
    to_account: ["to_account", "toaccount", "beneficiary_account", "credit_account", "to"],
    amount: ["amount", "amount_inr", "value", "amt"],
    currency: ["currency", "ccy"],
    ts: ["ts", "date", "timestamp", "txn_date", "time"],
    channel: ["channel", "method", "mode", "payment_mode"],
    id: ["id", "txn_id", "transaction_id", "ref"],
  },
  // cdr_records
  telecom: {
    caller_msisdn: ["caller_msisdn", "caller", "a_party", "from_number"],
    callee_msisdn: ["callee_msisdn", "callee", "b_party", "to_number"],
    start_ts: ["start_ts", "start_time", "date", "timestamp", "ts"],
    duration_s: ["duration_s", "duration", "dur"],
    call_type: ["call_type", "type"],
    imei: ["imei"],
    cell_id: ["cell_id", "tower", "cell"],
    lat: ["lat", "latitude"],
    lon: ["lon", "lng", "longitude"],
  },
  // location_history
  location: {
    entity_id: ["entity_id", "person_id", "subject"],
    ts: ["ts", "date", "timestamp", "time"],
    lat: ["lat", "latitude"],
    lon: ["lon", "lng", "longitude"],
    origin: ["origin", "source"],
    accuracy_m: ["accuracy_m", "accuracy"],
  },
  // entities + identifiers (vehicle registrations)
  vehicle: {
    canonical_name: ["canonical_name", "owner", "owner_name", "name"],
    value: ["value", "registration", "reg_no", "plate", "vehicle_no"],
    type: ["type", "vehicle_type"],
  },
  // entities + identifiers (biometric / identity)
  identity: {
    canonical_name: ["canonical_name", "name", "full_name"],
    nafis_id: ["nafis_id", "nafis"],
    value: ["value", "aadhaar", "uid", "id_number"],
    dob: ["dob", "date_of_birth"],
    gender: ["gender", "sex"],
  },
  // source_files + cases (FIR / case records)
  case: {
    case_code: ["case_code", "case_no", "fir_no", "fir"],
    title: ["title", "subject"],
    jurisdiction: ["jurisdiction", "police_station", "ps"],
    filename: ["filename", "file", "document"],
  },
};

/** normalize a header for tolerant matching: lowercase, strip non-alphanumerics. */
function norm(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes ("")
 * and commas inside quotes. Good enough for the flat investigative exports this
 * pipeline ingests.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((v) => v.trim() !== "")) rows.push(row);
  }

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows };
}

/**
 * Really run the ingest logic over an uploaded file.
 *
 * - CSV: parse the real header + rows, match each header against the target
 *   table's columns for the chosen category, count actual rows, and isolate the
 *   headers that have no schema home (with a real sample value from row 1).
 * - PDF: no client-side text layer here, so fall back to a document-count stub
 *   (real OCR/NER is the backend follow-up).
 */
export function runIngest(fileName: string, categoryId: string, csvText?: string): PipelineResult {
  const isPdf = /\.pdf$/i.test(fileName);

  if (!isPdf && csvText !== undefined) {
    const { headers, rows } = parseCsv(csvText);
    const schema = SCHEMA_FIELDS[categoryId] ?? {};

    const mappedFields: MappedField[] = [];
    const unmapped: UnmappedField[] = [];

    headers.forEach((header, idx) => {
      const key = norm(header);
      // "other" maps nothing; every column is isolated for review.
      let target: string | null = null;
      if (categoryId !== "other") {
        for (const [col, aliases] of Object.entries(schema)) {
          if (aliases.some((a) => norm(a) === key)) { target = col; break; }
        }
      }
      if (target) {
        mappedFields.push({ header, target });
      } else {
        const sample = rows.find((r) => (r[idx] ?? "").trim() !== "")?.[idx]?.trim() ?? "—";
        unmapped.push({ column: header, sample });
      }
    });

    return {
      fileName,
      category: categoryId,
      kind: "csv",
      rowsDetected: rows.length,
      mappedCount: mappedFields.length,
      isolatedCount: unmapped.length,
      mappedFields,
      unmapped,
    };
  }

  // PDF stub — a document, not tabular rows.
  return {
    fileName,
    category: categoryId,
    kind: "pdf",
    rowsDetected: 1,
    mappedCount: categoryId === "other" ? 0 : 1,
    isolatedCount: categoryId === "other" ? 1 : 0,
    mappedFields: [],
    unmapped:
      categoryId === "other"
        ? [{ column: "(whole document)", sample: "held for OCR + review" }]
        : [],
  };
}
