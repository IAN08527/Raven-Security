import { create } from "zustand";
import type { GraphNode } from "../types/generated";

export interface WorkspaceTab {
  id: string;
  type: "graph" | "profiles-dir" | "profile" | "vision" | "audit" | "document" | "databases" | "ingest";
  title: string;
  url?: string;
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
    coAccused?: any[];
    sha256?: string;
    text?: string;
    entities?: any[];
    identifiers?: any[];
    relations?: any[];
    incident?: any;
    filename?: string;
  };
}

export type ProfileSubTab = "general" | "vehicles" | "fir" | "routines" | "micronet";


interface CaseState {
  caseId: string;
  setCaseId: (id: string) => void;
  // Browser Sidebar Collapse
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Dynamic Ingest Modal
  ingestModalOpen: boolean;
  setIngestModalOpen: (open: boolean) => void;

  // Ingest completion ticker — bump this after any successful upload to trigger live refreshes
  lastIngestTime: number;
  bumpIngestTime: () => void;

  // Dynamic Tab System
  tabs: WorkspaceTab[];
  activeTabId: string;
  tabHistory: string[];
  historyIndex: number;
  openTab: (tab: WorkspaceTab) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  navigateBack: () => void;
  navigateForward: () => void;

  // Active navigation in sidebar
  activeNav: "profiles" | "graph" | "cctv" | "logs" | "databases" | "ingest" | "documents";
  setActiveNav: (nav: "profiles" | "graph" | "cctv" | "logs" | "databases" | "ingest" | "documents") => void;

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

// Persist the active module across refreshes (otherwise state resets to Profiles).
type NavId = "profiles" | "graph" | "cctv" | "logs" | "databases" | "ingest" | "documents";
const NAV_KEY = "raven.activeNav";
const NAV_BASE: Record<NavId, WorkspaceTab> = {
  profiles: { id: "tab-profiles-dir", type: "profiles-dir", title: "Profiles Directory", url: "raven://op-raven-01/profiles" },
  graph: { id: "tab-graph", type: "graph", title: "Macro Network", url: "raven://op-raven-01/graph" },
  cctv: { id: "tab-cctv", type: "vision", title: "CCTV Live Monitor - Cam 01", url: "raven://op-raven-01/vision/cam-01" },
  logs: { id: "tab-logs", type: "audit", title: "Audit Ledger", url: "raven://op-raven-01/audit/ledger" },
  databases: { id: "tab-databases", type: "databases", title: "Data Sources & Ingest", url: "raven://op-raven-01/data-sources" },
  ingest: { id: "tab-databases", type: "databases", title: "Data Sources & Ingest", url: "raven://op-raven-01/ingest" },
  documents: { id: "tab-doc-sample", type: "document", title: "Document: FIR-124/2026", url: "raven://op-raven-01/documents/fir-124" },
};
function readInitialNav(): NavId {
  try {
    const v = localStorage.getItem(NAV_KEY);
    if (v && v in NAV_BASE) return v as NavId;
  } catch {
    /* localStorage unavailable */
  }
  return "profiles";
}
const INITIAL_NAV = readInitialNav();
const INITIAL_TAB = NAV_BASE[INITIAL_NAV];

export const useCaseStore = create<CaseState>((set, get) => ({
  caseId: "OP-RAVEN-01",
  setCaseId: (id) => set({ caseId: id }),

  // Sidebar collapsed state
  isSidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed })),
  setSidebarCollapsed: (c) => set({ isSidebarCollapsed: c }),

  // Ingest Modal state
  ingestModalOpen: false,
  setIngestModalOpen: (open) => set({ ingestModalOpen: open }),

  // Ingest ticker - bump after any successful upload
  lastIngestTime: 0,
  bumpIngestTime: () => set({ lastIngestTime: Date.now() }),



  // Restore the last-viewed module on refresh (falls back to Profiles).
  tabs: [INITIAL_TAB],
  activeTabId: INITIAL_TAB.id,
  activeNav: INITIAL_NAV,
  tabHistory: [INITIAL_TAB.id],
  historyIndex: 0,

  openTab: (tab) => {
    const { tabs, tabHistory, historyIndex } = get();
    const existing = tabs.find((t) => t.id === tab.id);
    const updatedTabs = existing
      ? tabs.map((t) => (t.id === tab.id ? { ...t, ...tab } : t))
      : [...tabs, tab];

    const nextHistory = [...tabHistory.slice(0, historyIndex + 1), tab.id];
    set({
      tabs: updatedTabs,
      activeTabId: tab.id,
      tabHistory: nextHistory,
      historyIndex: nextHistory.length - 1,
      profileSubTab: tab.type === "profile" ? "general" : get().profileSubTab,
    });
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId, tabHistory, historyIndex } = get();
    if (tabs.length <= 1) return; // Keep at least one tab
    const nextTabs = tabs.filter((t) => t.id !== tabId);
    let nextActiveId = activeTabId;
    if (activeTabId === tabId) {
      const idx = tabs.findIndex((t) => t.id === tabId);
      nextActiveId = nextTabs[Math.max(0, idx - 1)]?.id || nextTabs[0].id;
    }
    const nextHistory = tabHistory.filter((id) => id !== tabId);
    set({
      tabs: nextTabs,
      activeTabId: nextActiveId,
      tabHistory: nextHistory.length > 0 ? nextHistory : [nextActiveId],
      historyIndex: Math.min(historyIndex, Math.max(0, nextHistory.length - 1)),
    });
  },

  setActiveTab: (tabId) => {
    const { tabs, tabHistory, historyIndex } = get();
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const nextHistory = [...tabHistory.slice(0, historyIndex + 1), tabId];
    set({
      activeTabId: tabId,
      tabHistory: nextHistory,
      historyIndex: nextHistory.length - 1,
      profileSubTab: tab.type === "profile" ? "general" : get().profileSubTab,
    });
  },

  navigateBack: () => {
    const { tabHistory, historyIndex, tabs } = get();
    if (historyIndex > 0) {
      const prevId = tabHistory[historyIndex - 1];
      if (tabs.some((t) => t.id === prevId)) {
        set({ activeTabId: prevId, historyIndex: historyIndex - 1 });
      }
    }
  },

  navigateForward: () => {
    const { tabHistory, historyIndex, tabs } = get();
    if (historyIndex < tabHistory.length - 1) {
      const nextId = tabHistory[historyIndex + 1];
      if (tabs.some((t) => t.id === nextId)) {
        set({ activeTabId: nextId, historyIndex: historyIndex + 1 });
      }
    }
  },

  setActiveNav: (nav) => {
    set({ activeNav: nav });
    if (nav === "profiles") {
      get().openTab({ id: "tab-profiles-dir", type: "profiles-dir", title: "Profiles Directory", url: "raven://op-raven-01/profiles" });
    } else if (nav === "graph") {
      get().openTab({ id: "tab-graph", type: "graph", title: "Macro Network", url: "raven://op-raven-01/graph" });
    } else if (nav === "cctv") {
      get().openTab({ id: "tab-cctv", type: "vision", title: "CCTV Live Monitor - Cam 01", url: "raven://op-raven-01/vision" });
    } else if (nav === "logs") {
      get().openTab({ id: "tab-logs", type: "audit", title: "Audit Ledger", url: "raven://op-raven-01/audit" });
    } else if (nav === "databases" || nav === "ingest") {
      get().openTab({ id: "tab-databases", type: "databases", title: "Data Sources & Ingest", url: "raven://op-raven-01/data-sources" });
    } else if (nav === "documents") {
      get().openTab({ id: "tab-doc-sample", type: "document", title: "Document: FIR-124/2026", url: "raven://op-raven-01/documents" });
    }
  },


  // Default to 'general' sub-tab on profile open
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
