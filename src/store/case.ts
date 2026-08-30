import { create } from "zustand";

interface CaseState {
  caseId: string | null;
  selectedEntityId: string | null;
  selectedEdgeId: string | null;
  activeView: "graph" | "map" | "vision" | "audit";
  // Graph view controls (Backlog #4).
  viewMode: "micro" | "macro";
  centerEntityId: string | null;
  minWeight: number;
  hops: number;
  setCase: (id: string) => void;
  selectEntity: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  setView: (v: CaseState["activeView"]) => void;
  setViewMode: (m: CaseState["viewMode"]) => void;
  setCenterEntity: (id: string | null) => void;
  setMinWeight: (w: number) => void;
  setHops: (h: number) => void;
}

export const useCaseStore = create<CaseState>((set) => ({
  caseId: "OP-RAVEN-01",
  selectedEntityId: null,
  selectedEdgeId: null,
  activeView: "graph",
  viewMode: "macro",
  centerEntityId: null,
  minWeight: 5,
  hops: 2,
  setCase: (id) => set({ caseId: id }),
  selectEntity: (id) => set({ selectedEntityId: id, selectedEdgeId: null }),
  selectEdge: (id) => set({ selectedEdgeId: id, selectedEntityId: null }),
  setView: (v) => set({ activeView: v }),
  setViewMode: (m) => set({ viewMode: m }),
  setCenterEntity: (id) => set({ centerEntityId: id }),
  setMinWeight: (w) => set({ minWeight: w }),
  setHops: (h) => set({ hops: h }),
}));
