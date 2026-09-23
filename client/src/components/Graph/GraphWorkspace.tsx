import { useCallback, useEffect, useState } from "react";
import type { EdgeEvidenceItem, EntityDetail, GraphEdge, GraphNode } from "../../types/api";
import { fetchEdgeEvidence, fetchEgoGraph, fetchEntity, fetchMacroGraph } from "../../lib/graphApi";
import { getSession } from "../../lib/session";
import { DEFAULT_FILTERS, GraphFilterPanel, type GraphFilters } from "./GraphFilterPanel";
import { NetworkGraph } from "./NetworkGraph";
import { EntityDetailPanel } from "./EntityDetailPanel";
import { EdgeEvidencePanel } from "./EdgeEvidencePanel";

// Network Graph workspace (reference top-middle, design §9).
// Person-centric ego/macro views on Cytoscape + fCoSE; edge selection
// opens evidence without re-querying the graph (FR-4.4).

function serverBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return (env?.VITE_SERVER_URL ?? "https://localhost:8443").replace(/\/$/, "");
}

export function GraphWorkspace({
  initialCaseId,
  onOpenEntity,
}: {
  initialCaseId: string;
  onOpenEntity: (entityId: string, caseId: string) => void;
}): JSX.Element {
  const [caseId, setCaseId] = useState(initialCaseId);
  useEffect(() => {
    if (initialCaseId) setCaseId(initialCaseId);
  }, [initialCaseId]);
  const [entityId, setEntityId] = useState("");
  const [mode, setMode] = useState<"macro" | "ego">("macro");
  const [filters, setFilters] = useState<GraphFilters>(DEFAULT_FILTERS);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [evidence, setEvidence] = useState<EdgeEvidenceItem[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  const load = useCallback(async () => {
    const session = getSession();
    if (!session || !caseId) return;
    if (mode === "ego" && !entityId.trim()) {
      setError("Ego mode needs a centre entity id.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload =
        mode === "ego"
          ? await fetchEgoGraph(serverBase(), session.token, caseId, entityId.trim(), {
              hops: 2,
              minWeight: filters.minWeight,
              types: filters.types,
            })
          : await fetchMacroGraph(serverBase(), session.token, caseId, {
              minWeight: filters.minWeight,
              types: filters.types,
            });
      setNodes(payload.nodes);
      setEdges(payload.edges);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setDetail(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Graph unavailable.");
    } finally {
      setLoading(false);
    }
  }, [caseId, entityId, mode, filters.minWeight, filters.types]);

  useEffect(() => {
    if (caseId) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, mode]);

  // Fetch entity detail + edge evidence independently (never re-layout).
  useEffect(() => {
    const session = getSession();
    if (!session || !selectedNodeId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    fetchEntity(serverBase(), session.token, selectedNodeId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedNodeId]);

  useEffect(() => {
    const session = getSession();
    if (!session || !selectedEdgeId) {
      setEvidence([]);
      return;
    }
    let cancelled = false;
    setEvidenceLoading(true);
    fetchEdgeEvidence(serverBase(), session.token, selectedEdgeId)
      .then((rows) => {
        if (!cancelled) setEvidence(rows);
      })
      .catch(() => {
        if (!cancelled) setEvidence([]);
      })
      .finally(() => {
        if (!cancelled) setEvidenceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedEdgeId]);

  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;
  const incidentEdges = selectedNodeId ? edges.filter((e) => e.src === selectedNodeId || e.dst === selectedNodeId) : [];

  return (
    <div className="flex h-full flex-col bg-[#151514] text-[#E8E5DD]">
      <header className="flex flex-wrap items-end gap-2 border-b border-[#30302D] bg-[#1B1B19] px-4 py-2">
        <div>
          <h1 className="text-lg text-[#E8E5DD]">Network Graph</h1>
          <p className="text-[11px] text-[#A5A29A]">Explore entities, relationships and evidence across cases.</p>
        </div>
        <label className="ml-auto flex flex-col gap-1 text-[11px] text-[#A5A29A]">
          Case id
          <input
            aria-label="Graph case id"
            value={caseId}
            onChange={(e) => setCaseId(e.target.value.trim())}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="w-72 border border-[#30302D] bg-[#171716] px-2 py-1 font-mono text-xs text-[#E8E5DD]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-[#A5A29A]">
          Mode
          <select
            aria-label="Graph mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as "macro" | "ego")}
            className="border border-[#30302D] bg-[#171716] px-2 py-1 text-xs text-[#E8E5DD]"
          >
            <option value="macro">Global (macro)</option>
            <option value="ego">Local (ego, 2 hops)</option>
          </select>
        </label>
        {mode === "ego" ? (
          <label className="flex flex-col gap-1 text-[11px] text-[#A5A29A]">
            Centre entity id
            <input
              aria-label="Centre entity id"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value.trim())}
              placeholder="entity uuid"
              className="w-64 border border-[#30302D] bg-[#171716] px-2 py-1 font-mono text-xs text-[#E8E5DD]"
            />
          </label>
        ) : null}
        <button
          type="button"
          onClick={() => void load()}
          disabled={!caseId || loading}
          className="border border-[#30302D] bg-[#262624] px-3 py-1 text-xs text-[#E8E5DD] disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load"}
        </button>
      </header>
      {error ? (
        <p role="alert" className="border-b border-[#30302D] px-4 py-1 text-xs text-[#D8665C]">
          {error}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div className="w-56 shrink-0 border-r border-[#30302D]">
          <GraphFilterPanel
            filters={filters}
            isolateAvailable={selectedNodeId !== null}
            resultCount={{ nodes: nodes.length, edges: edges.length }}
            onChange={setFilters}
          />
        </div>
        <div className="min-w-0 flex-1">
          <NetworkGraph
            caseId={caseId || "—"}
            payload={{ nodes, edges }}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            isolatedNodeId={filters.isolate ? selectedNodeId : null}
            onNodeSelect={(id) => {
              setSelectedNodeId(id);
              if (id) setSelectedEdgeId(null);
            }}
            onEdgeSelect={(id) => {
              setSelectedEdgeId(id);
              if (id) setSelectedNodeId(null);
            }}
            onExported={() => undefined}
          />
        </div>
        <div className="w-80 shrink-0 border-l border-[#30302D]">
          {selectedEdge ? (
            <EdgeEvidencePanel
              edge={selectedEdge}
              items={evidence}
              loading={evidenceLoading}
              dateRange={filters.dateRange}
              onClose={() => setSelectedEdgeId(null)}
            />
          ) : (
            <EntityDetailPanel
              detail={selectedNodeId ? detail : null}
              caseId={caseId}
              incidentEdges={incidentEdges}
              onSelectEdge={(edgeId) => {
                setSelectedEdgeId(edgeId);
                setSelectedNodeId(null);
              }}
              onOpenProfile={(id) => onOpenEntity(id, caseId)}
              onClose={() => setSelectedNodeId(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
