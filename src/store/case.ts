import { create } from "zustand";
import type { ElementDefinition } from "cytoscape";
import type { GraphNode } from "../types/generated";
import {
  processCsvIngest,
  processDocumentIngest,
  type ExtractedSuspect,
  type ExtractedDocument,
  type IngestionOutcome,
  type ScannedCandidate,
} from "../dev/dynamicIngest";

export interface WorkspaceTab {
  id: string;
  type: "graph" | "profiles-dir" | "profile" | "vision" | "audit" | "document" | "databases";
  title: string;
  data?: {
    entityId?: string;
    entityName?: string;
    role?: string;
    riskScore?: number;
    // Document specific
    docId?: string;
    firNo?: string;
    policeStation?: string;
    incidentDate?: string;
    ipcSections?: string;
    coAccused?: { name: string; alias: string; role: string; id: string }[];
    sha256?: string;
  };
}

export type ProfileSubTab = "general" | "vehicles" | "fir" | "routines" | "micronet";

export interface ProfileRecord {
  id: string;
  name: string;
  alias: string;
  role: string;
  roleTier: "leader" | "operator" | "logistics" | "mule" | "associate";
  aadhaar: string;
  phone: string;
  vehicle: string;
  cases: string;
  riskScore: number;
  riskLevel: "HIGH" | "MED" | "LOW";
  status: "Active Suspect" | "Under Watch" | "Detained";
}

export interface LedgerRecord {
  fileId: string;
  filename: string;
  sha256: string;
  blockNumber: number;
  anchorTime: string;
  status: "VERIFIED" | "PENDING" | "TAMPERED";
  accessedBy: string;
  size: string;
}

export interface IngestedDataset {
  fileId: string;
  fileName: string;
  category: string;
  sha256: string;
  rowCount: number;
  headers: string[];
  rows: Record<string, string>[];
  ingestedAt: string;
}

export interface RecentIngest {
  fileId: string;
  fileName: string;
  sha256: string;
  rows: number;
  status: "COMMITTED" | "PENDING" | "ISOLATED";
  source: string;
  size: string;
  timeAgo: string;
}

export interface ConnectedStoreInfo {
  id: string;
  name: string;
  kind: "postgres" | "graph" | "storage" | "ledger";
  role: string;
  location: string;
  health: "up" | "degraded" | "down";
  integrity: number;
  records: number;
  recordLabel: string;
  lastSync: string;
}

export interface CaseState {
  caseId: string;

  // Dynamic Tab System
  tabs: WorkspaceTab[];
  activeTabId: string;
  openTab: (tab: WorkspaceTab) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;

  // Active navigation in sidebar
  activeNav: "profiles" | "graph" | "cctv" | "logs" | "databases";
  setActiveNav: (nav: "profiles" | "graph" | "cctv" | "logs" | "databases") => void;

  // Dynamic Profiles Pool
  profiles: ProfileRecord[];
  addProfile: (p: ProfileRecord) => void;
  addProfiles: (ps: ProfileRecord[]) => void;

  // Dynamic Audit Ledger Pool
  auditLog: LedgerRecord[];
  addAuditRecord: (r: LedgerRecord) => void;

  // Dynamic Documents Pool
  documents: ExtractedDocument[];
  addDocument: (d: ExtractedDocument) => void;

  // Dynamic Databases Stores & Ingests
  connectedStores: ConnectedStoreInfo[];
  recentIngests: RecentIngest[];
  ingestedDatasets: IngestedDataset[];
  addRecentIngest: (r: RecentIngest) => void;
  addIngestedDataset: (d: IngestedDataset) => void;

  // Dynamic Graph Nodes & Edges
  dynamicGraphNodes: ElementDefinition[];
  dynamicGraphEdges: ElementDefinition[];
  addDynamicGraphElements: (nodes: ElementDefinition[], edges: ElementDefinition[]) => void;

  // Global Ingestion Modal
  isIngestModalOpen: boolean;
  openIngestModal: () => void;
  closeIngestModal: () => void;

  // Notifications
  notification: { message: string; type: "success" | "info" | "warning"; details?: string } | null;
  setNotification: (n: { message: string; type: "success" | "info" | "warning"; details?: string } | null) => void;

  // Scan & Selective Commit Actions
  scanFile: (params: {
    file?: File;
    name: string;
    text?: string;
    category?: string;
    byteSize?: number;
  }) => Promise<IngestionOutcome>;

  commitSelectedCandidates: (
    outcome: IngestionOutcome,
    selectedCandidateIds: Set<string>
  ) => { savedSuspects: number; savedNodes: number; savedEdges: number; savedRows: number };

  // Profile Workspace Sub-Tabs
  profileSubTab: ProfileSubTab;
  setProfileSubTab: (subTab: ProfileSubTab) => void;

  // Selected Entity / Edge
  selectedEntityId: string | null;
  selectedEdgeId: string | null;
  selectEntity: (id: string | null) => void;
  selectEdge: (id: string | null) => void;

  // Macro Graph Controls
  viewMode: "micro" | "macro";
  centerEntityId: string | null;
  minWeight: number;
  hops: number;
  layerFilters: {
    people: boolean;
    vehicles: boolean;
    institutions: boolean;
    accounts: boolean;
  };
  setLayerFilter: (layer: "vehicles" | "institutions" | "accounts", value: boolean) => void;
  setViewMode: (m: "micro" | "macro") => void;
  setCenterEntity: (id: string | null) => void;
  setMinWeight: (w: number) => void;
  setHops: (h: number) => void;

  // Contextual Slide-Drawer
  drawerNode: GraphNode | null;
  isDrawerOpen: boolean;
  openDrawer: (node: GraphNode) => void;
  closeDrawer: () => void;

  // CCTV State
  cctvState: {
    detecting: boolean;
    lockedTargetId: string | null;
    trackingStarted: boolean;
    activeCam: string;
  };
  triggerDetectAll: () => void;
  lockCctvTarget: (targetId: string | null) => void;
  startMultiCamTracking: () => void;
  setActiveCam: (camId: string) => void;

  // Command Palette
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
}

// ── INITIAL BASELINE PROFILES ──
const INITIAL_PROFILES: ProfileRecord[] = [
  {
    id: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332",
    name: "Rakesh Sawant",
    alias: "Ricky",
    role: "Syndicate Leader",
    roleTier: "leader",
    aadhaar: "XXXX-XXXX-4521",
    phone: "+91 98765 43210",
    vehicle: "MH-02-AB-1234",
    cases: "OP-RAVEN-01, FIR-102",
    riskScore: 0.84,
    riskLevel: "HIGH",
    status: "Active Suspect",
  },
  {
    id: "8c35e396-4191-5369-9c5c-7ec65df27d5e",
    name: "Vikram Patel",
    alias: "Vicky",
    role: "Hawala Operator",
    roleTier: "operator",
    aadhaar: "XXXX-XXXX-8912",
    phone: "+91 98111 22334",
    vehicle: "MH-01-CD-5678",
    cases: "OP-RAVEN-01",
    riskScore: 0.62,
    riskLevel: "MED",
    status: "Active Suspect",
  },
  {
    id: "5761aefc-da70-5883-999a-00e998a4d468",
    name: "Mohd. Khan",
    alias: "Bhai",
    role: "Logistics Coordinator",
    roleTier: "logistics",
    aadhaar: "XXXX-XXXX-3341",
    phone: "+91 99222 44556",
    vehicle: "MH-04-EF-9012",
    cases: "OP-RAVEN-01",
    riskScore: 0.51,
    riskLevel: "MED",
    status: "Under Watch",
  },
  {
    id: "3e46c76c-3dc4-5264-a0c5-ee169992f4ad",
    name: "Sunil Gupta",
    alias: "Doctor",
    role: "Money Mule",
    roleTier: "mule",
    aadhaar: "XXXX-XXXX-7729",
    phone: "+91 98333 66778",
    vehicle: "MH-03-GH-3456",
    cases: "OP-RAVEN-01",
    riskScore: 0.4,
    riskLevel: "LOW",
    status: "Under Watch",
  },
  {
    id: "9c3e41b9-8e7c-50f9-bd17-91a5f4c6e93b",
    name: "Anita Roy",
    alias: "Madam",
    role: "Shell Company Director",
    roleTier: "operator",
    aadhaar: "XXXX-XXXX-1123",
    phone: "+91 98444 88990",
    vehicle: "MH-02-JK-7890",
    cases: "OP-RAVEN-01",
    riskScore: 0.35,
    riskLevel: "LOW",
    status: "Under Watch",
  },
  {
    id: "7b4c92a1-3d5f-51e8-9c12-34e56f789abc",
    name: "Deepak Kumar",
    alias: "DK",
    role: "Field Associate",
    roleTier: "associate",
    aadhaar: "XXXX-XXXX-9980",
    phone: "+91 98555 11223",
    vehicle: "MH-01-LM-2345",
    cases: "OP-RAVEN-01",
    riskScore: 0.28,
    riskLevel: "LOW",
    status: "Detained",
  },
];

const INITIAL_AUDIT: LedgerRecord[] = [
  {
    fileId: "f-01",
    filename: "fir_102_final.pdf",
    sha256: "7a3f4c2d1e8b9a0f3e2d1c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f",
    blockNumber: 14209,
    anchorTime: "2026-08-28 14:30:02 UTC",
    status: "VERIFIED",
    accessedBy: "IO A. Kumar",
    size: "1.2 MB",
  },
  {
    fileId: "f-02",
    filename: "cdr_batch_march_2024.csv",
    sha256: "b4e29f1a8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f",
    blockNumber: 14210,
    anchorTime: "2026-08-28 14:35:18 UTC",
    status: "VERIFIED",
    accessedBy: "Analyst B. Singh",
    size: "4.8 MB",
  },
  {
    fileId: "f-03",
    filename: "suspect_wiretap_log_audio.wav",
    sha256: "9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b",
    blockNumber: 14212,
    anchorTime: "2026-08-28 15:10:44 UTC",
    status: "TAMPERED",
    accessedBy: "External Gateway (Mismatch)",
    size: "14.2 MB",
  },
  {
    fileId: "f-04",
    filename: "cctv_cam01_footage_clip.mp4",
    sha256: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
    blockNumber: 14215,
    anchorTime: "2026-08-28 15:45:00 UTC",
    status: "VERIFIED",
    accessedBy: "IO A. Kumar",
    size: "45.0 MB",
  },
  {
    fileId: "f-05",
    filename: "bank_ledger_syndicate_accts.xlsx",
    sha256: "3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e",
    blockNumber: 14218,
    anchorTime: "2026-08-28 16:00:11 UTC",
    status: "PENDING",
    accessedBy: "System Saga Ingestion",
    size: "820 KB",
  },
];

const INITIAL_STORES: ConnectedStoreInfo[] = [
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

const INITIAL_RECENT: RecentIngest[] = [
  {
    fileId: "f-01",
    fileName: "fir_102_final.pdf",
    sha256: "7a3f4c2d1e8b9a0f3e2d1c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f",
    rows: 1,
    status: "COMMITTED",
    source: "CCTNS",
    size: "1.2 MB",
    timeAgo: "2m ago",
  },
  {
    fileId: "f-02",
    fileName: "cdr_batch_march_2024.csv",
    sha256: "b4e29f1a8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f",
    rows: 1420,
    status: "COMMITTED",
    source: "TELECOM",
    size: "4.8 MB",
    timeAgo: "14m ago",
  },
  {
    fileId: "f-05",
    fileName: "bank_ledger_syndicate_accts.xlsx",
    sha256: "3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e",
    rows: 382,
    status: "PENDING",
    source: "CFCFRMS",
    size: "820 KB",
    timeAgo: "1h ago",
  },
];

// Persistent localStorage helpers
function loadPersistedProfiles(): ProfileRecord[] {
  try {
    const raw = localStorage.getItem("raven.saved_profiles");
    if (raw) return JSON.parse(raw);
  } catch {}
  return INITIAL_PROFILES;
}

function loadPersistedDatasets(): IngestedDataset[] {
  try {
    const raw = localStorage.getItem("raven.saved_datasets");
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

type NavId = "profiles" | "graph" | "cctv" | "logs" | "databases";
const NAV_KEY = "raven.activeNav";
const NAV_BASE: Record<NavId, WorkspaceTab> = {
  profiles: { id: "tab-profiles-dir", type: "profiles-dir", title: "Profiles Directory" },
  graph: { id: "tab-graph", type: "graph", title: "Macro Network" },
  cctv: { id: "tab-cctv", type: "vision", title: "CCTV Live Monitor - Cam 01" },
  logs: { id: "tab-logs", type: "audit", title: "Audit Ledger" },
  databases: { id: "tab-databases", type: "databases", title: "Data Sources" },
};

function readInitialNav(): NavId {
  try {
    const v = localStorage.getItem(NAV_KEY);
    if (v && v in NAV_BASE) return v as NavId;
  } catch {}
  return "profiles";
}
const INITIAL_NAV = readInitialNav();
const INITIAL_TAB = NAV_BASE[INITIAL_NAV];

export const useCaseStore = create<CaseState>((set, get) => ({
  caseId: "OP-RAVEN-01",

  tabs: [INITIAL_TAB],
  activeTabId: INITIAL_TAB.id,
  activeNav: INITIAL_NAV,

  profiles: loadPersistedProfiles(),
  addProfile: (p) =>
    set((s) => {
      const updated = [p, ...s.profiles.filter((x) => x.id !== p.id && x.name !== p.name)];
      try {
        localStorage.setItem("raven.saved_profiles", JSON.stringify(updated));
      } catch {}
      return { profiles: updated };
    }),
  addProfiles: (ps) =>
    set((s) => {
      const existing = new Set(s.profiles.map((p) => p.name.toLowerCase()));
      const filtered = ps.filter((p) => !existing.has(p.name.toLowerCase()));
      const updated = [...filtered, ...s.profiles];
      try {
        localStorage.setItem("raven.saved_profiles", JSON.stringify(updated));
      } catch {}
      return { profiles: updated };
    }),

  auditLog: INITIAL_AUDIT,
  addAuditRecord: (r) => set((s) => ({ auditLog: [r, ...s.auditLog] })),

  documents: [],
  addDocument: (d) =>
    set((s) => ({
      documents: [d, ...s.documents.filter((x) => x.docId !== d.docId)],
    })),

  connectedStores: INITIAL_STORES,
  recentIngests: INITIAL_RECENT,
  ingestedDatasets: loadPersistedDatasets(),
  addRecentIngest: (ri) => set((s) => ({ recentIngests: [ri, ...s.recentIngests] })),
  addIngestedDataset: (ds) =>
    set((s) => {
      const updated = [ds, ...s.ingestedDatasets.filter((x) => x.fileId !== ds.fileId)];
      try {
        localStorage.setItem("raven.saved_datasets", JSON.stringify(updated));
      } catch {}
      return { ingestedDatasets: updated };
    }),

  dynamicGraphNodes: [],
  dynamicGraphEdges: [],
  addDynamicGraphElements: (nodes, edges) =>
    set((s) => {
      const existingNodeIds = new Set(s.dynamicGraphNodes.map((n) => n.data.id));
      const existingEdgeIds = new Set(s.dynamicGraphEdges.map((e) => e.data.id));

      const newNodes = nodes.filter((n) => !existingNodeIds.has(n.data.id));
      const newEdges = edges.filter((e) => !existingEdgeIds.has(e.data.id));

      return {
        dynamicGraphNodes: [...s.dynamicGraphNodes, ...newNodes],
        dynamicGraphEdges: [...s.dynamicGraphEdges, ...newEdges],
      };
    }),

  isIngestModalOpen: false,
  openIngestModal: () => set({ isIngestModalOpen: true }),
  closeIngestModal: () => set({ isIngestModalOpen: false }),

  notification: null,
  setNotification: (n) => set({ notification: n }),

  /**
   * Scan stage: extracts candidate entities & relations without committing immediately.
   * Returns outcome with full candidates list for user review.
   */
  scanFile: async ({ file, name, text, category, byteSize }) => {
    let contentText = text ?? "";
    let fileSize = byteSize ?? (file ? file.size : 0);

    if (file && !text) {
      try {
        contentText = await file.text();
      } catch {
        contentText = "";
      }
    }

    const isCsv = /\.csv$/i.test(name) || (category && category !== "case");
    if (isCsv) {
      return await processCsvIngest(name, contentText, category || "financial", fileSize);
    } else {
      return await processDocumentIngest(name, contentText, fileSize);
    }
  },

  /**
   * Selective commit: commits ONLY the items approved / checked by the officer.
   */
  commitSelectedCandidates: (outcome, selectedCandidateIds) => {
    const selectedNodes: ElementDefinition[] = [];
    const selectedEdges: ElementDefinition[] = [];
    const selectedSuspects: ExtractedSuspect[] = [];
    const selectedRows: Record<string, string>[] = [];
    let selectedDoc: ExtractedDocument | undefined;

    outcome.candidates.forEach((cand) => {
      if (selectedCandidateIds.has(cand.id)) {
        if (cand.nodeData) selectedNodes.push(cand.nodeData);
        if (cand.edgeData) selectedEdges.push(cand.edgeData);
        if (cand.suspectData) selectedSuspects.push(cand.suspectData);
        if (cand.docData) selectedDoc = cand.docData;
        if (cand.rowData) selectedRows.push(cand.rowData);
      }
    });

    // 1. Commit selected suspects into Profiles directory
    if (selectedSuspects.length > 0) {
      get().addProfiles(selectedSuspects);
    }

    // 2. Commit selected nodes & edges into Graph
    if (selectedNodes.length > 0 || selectedEdges.length > 0) {
      get().addDynamicGraphElements(selectedNodes, selectedEdges);
    }

    // 3. Commit document if selected
    if (selectedDoc) {
      get().addDocument(selectedDoc);
    }

    // 4. Commit into Ingested Datasets
    if (selectedRows.length > 0) {
      const headers = Object.keys(selectedRows[0] || {});
      get().addIngestedDataset({
        fileId: outcome.fileId,
        fileName: outcome.fileName,
        category: outcome.category,
        sha256: outcome.sha256,
        rowCount: selectedRows.length,
        headers,
        rows: selectedRows,
        ingestedAt: new Date().toLocaleTimeString(),
      });
    }

    // 5. Emit Audit Record
    const auditRecord: LedgerRecord = {
      fileId: outcome.fileId,
      filename: outcome.fileName,
      sha256: outcome.sha256,
      blockNumber: outcome.blockNumber,
      anchorTime: new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC",
      status: "VERIFIED",
      accessedBy: "IO A. Kumar (Selective Commit)",
      size: outcome.fileSizeLabel,
    };
    get().addAuditRecord(auditRecord);

    // 6. Update Recent Ingests
    const recentItem: RecentIngest = {
      fileId: outcome.fileId,
      fileName: outcome.fileName,
      sha256: outcome.sha256,
      rows: selectedRows.length > 0 ? selectedRows.length : selectedSuspects.length,
      status: "COMMITTED",
      source: outcome.category.toUpperCase(),
      size: outcome.fileSizeLabel,
      timeAgo: "just now",
    };
    get().addRecentIngest(recentItem);

    // 7. Update Connected Stores record count
    set((s) => ({
      connectedStores: s.connectedStores.map((st) => {
        if (st.kind === "postgres") {
          return { ...st, records: st.records + selectedRows.length, lastSync: "just now" };
        }
        if (st.kind === "graph") {
          return { ...st, records: st.records + selectedNodes.length, lastSync: "just now" };
        }
        if (st.kind === "storage" || st.kind === "ledger") {
          return { ...st, records: st.records + 1, lastSync: "just now" };
        }
        return st;
      }),
      notification: {
        type: "success",
        message: `Saved ${selectedSuspects.length} suspects and ${selectedNodes.length + selectedEdges.length} graph records`,
        details: `Committed ${selectedRows.length} dataset rows from ${outcome.fileName} into the verified database.`,
      },
    }));

    return {
      savedSuspects: selectedSuspects.length,
      savedNodes: selectedNodes.length,
      savedEdges: selectedEdges.length,
      savedRows: selectedRows.length,
    };
  },

  openTab: (tab) => {
    const { tabs } = get();
    const existing = tabs.find((t) => t.id === tab.id);
    if (!existing) {
      if (tab.type === "profile") {
        set({ tabs: [...tabs, tab], activeTabId: tab.id, profileSubTab: "general" });
      } else {
        set({ tabs: [...tabs, tab], activeTabId: tab.id });
      }
    } else {
      if (tab.type === "profile") {
        set({ activeTabId: tab.id, profileSubTab: "general" });
      } else {
        set({ activeTabId: tab.id });
      }
    }
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    if (tabs.length <= 1) return;
    const nextTabs = tabs.filter((t) => t.id !== tabId);
    let nextActiveId = activeTabId;
    if (activeTabId === tabId) {
      const idx = tabs.findIndex((t) => t.id === tabId);
      nextActiveId = nextTabs[Math.max(0, idx - 1)]?.id || nextTabs[0].id;
    }
    set({ tabs: nextTabs, activeTabId: nextActiveId });
  },

  setActiveTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (tab?.type === "profile") {
      set({ activeTabId: tabId, profileSubTab: "general" });
    } else {
      set({ activeTabId: tabId });
    }
  },

  setActiveNav: (nav) => {
    set({ activeNav: nav });
    try {
      localStorage.setItem(NAV_KEY, nav);
    } catch {}
    if (nav === "profiles") {
      get().openTab({ id: "tab-profiles-dir", type: "profiles-dir", title: "Profiles Directory" });
    } else if (nav === "graph") {
      get().openTab({ id: "tab-graph", type: "graph", title: "Macro Network" });
    } else if (nav === "cctv") {
      get().openTab({ id: "tab-cctv", type: "vision", title: "CCTV Live Monitor - Cam 01" });
    } else if (nav === "logs") {
      get().openTab({ id: "tab-logs", type: "audit", title: "Audit Ledger" });
    } else if (nav === "databases") {
      get().openTab({ id: "tab-databases", type: "databases", title: "Data Sources" });
    }
  },

  profileSubTab: "general",
  setProfileSubTab: (subTab) => set({ profileSubTab: subTab }),

  selectedEntityId: null,
  selectedEdgeId: null,
  selectEntity: (id) => set({ selectedEntityId: id, selectedEdgeId: null }),
  selectEdge: (id) => set({ selectedEdgeId: id, selectedEntityId: null }),

  viewMode: "macro",
  centerEntityId: null,
  minWeight: 5,
  hops: 2,
  layerFilters: {
    people: true,
    vehicles: true,
    institutions: true,
    accounts: true,
  },
  setLayerFilter: (layer, value) =>
    set((s) => ({ layerFilters: { ...s.layerFilters, [layer]: value } })),
  setViewMode: (m) => set({ viewMode: m }),
  setCenterEntity: (id) => set({ centerEntityId: id }),
  setMinWeight: (w) => set({ minWeight: w }),
  setHops: (h) => set({ hops: h }),

  drawerNode: null,
  isDrawerOpen: false,
  openDrawer: (node) => set({ drawerNode: node, isDrawerOpen: true }),
  closeDrawer: () => set({ drawerNode: null, isDrawerOpen: false }),

  cctvState: {
    detecting: true,
    lockedTargetId: "03",
    trackingStarted: false,
    activeCam: "CAM-01",
  },
  triggerDetectAll: () =>
    set((s) => ({
      cctvState: { ...s.cctvState, detecting: true },
    })),
  lockCctvTarget: (targetId) =>
    set((s) => ({
      cctvState: { ...s.cctvState, lockedTargetId: targetId },
    })),
  startMultiCamTracking: () =>
    set((s) => ({
      cctvState: { ...s.cctvState, trackingStarted: true },
    })),
  setActiveCam: (camId) =>
    set((s) => ({
      cctvState: { ...s.cctvState, activeCam: camId },
    })),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
}));
