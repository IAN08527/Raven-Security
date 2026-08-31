import { create } from "zustand";
import type { GraphNode } from "../types/generated";

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
    coAccused?: string[];
    sha256?: string;
  };
}

export type ProfileSubTab = "general" | "vehicles" | "fir" | "routines" | "micronet";


interface CaseState {
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

export const useCaseStore = create<CaseState>((set, get) => ({
  caseId: "OP-RAVEN-01",

  // Default to Profiles Directory on startup / refresh per user specification
  tabs: [
    { id: "tab-profiles-dir", type: "profiles-dir", title: "Profiles Directory" },
  ],
  activeTabId: "tab-profiles-dir",
  activeNav: "profiles",

  openTab: (tab) => {
    const { tabs } = get();
    const existing = tabs.find((t) => t.id === tab.id);
    if (!existing) {
      // If opening a profile tab, ensure it starts on 'general'
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
    if (tabs.length <= 1) return; // Keep at least one tab
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
