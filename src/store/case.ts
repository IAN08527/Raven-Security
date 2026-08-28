import { create } from "zustand";

interface CaseState {
  caseId: string | null;
  selectedEntityId: string | null;
  selectedEdgeId: string | null;
  activeView: "graph" | "map" | "vision" | "audit";
  setCase: (id: string) => void;
  selectEntity: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  setView: (v: CaseState["activeView"]) => void;
}

export const useCaseStore = create<CaseState>((set) => ({
  caseId: "OP-RAVEN-01",
  selectedEntityId: null,
  selectedEdgeId: null,
  activeView: "graph",
  setCase: (id) => set({ caseId: id }),
  selectEntity: (id) => set({ selectedEntityId: id }),
  selectEdge: (id) => set({ selectedEdgeId: id }),
  setView: (v) => set({ activeView: v }),
}));
