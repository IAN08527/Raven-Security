import { useMemo, useState } from "react";
import type { EdgeEvidenceItem, EntityDetail, GraphEdge, GraphNode } from "../types/api";
import { EdgeEvidencePanel } from "../components/Graph/EdgeEvidencePanel";
import type { DateRange } from "../components/Graph/EdgeEvidencePanel";
import { EntityDetailPanel } from "../components/Graph/EntityDetailPanel";
import { EntityProfile, navigateWithTransition } from "../components/Graph/EntityProfile";
import { DEFAULT_FILTERS, GraphFilterPanel } from "../components/Graph/GraphFilterPanel";
import type { GraphFilters } from "../components/Graph/GraphFilterPanel";
import { NetworkGraph } from "../components/Graph/NetworkGraph";

/**
 * Dev-only harness for eyeballing M4-T5's acceptance criteria without a
 * live server -- mock payload below, `data:`-free (no pixels needed for
 * a graph). Nothing here is presented as a real measurement (rule 10);
 * node positions come from the fCoSE run, edge weights and the single
 * TAMPERED row are hand-set props to exercise the panels, nothing more.
 * Open with `?graph-demo` in dev (`import.meta.env.DEV` is false in
 * `vite build`).
 */

const DEMO_NODES: GraphNode[] = [
  { id: "p1", type: "PERSON", label: "Ravi Kumar" },
  { id: "p2", type: "PERSON", label: "Suresh Yadav" },
  { id: "o1", type: "ORGANIZATION", label: "Sharma Traders" },
  { id: "a1", type: "ACCOUNT", label: "SBIN ****4521" },
  { id: "l1", type: "LOCATION", label: "Dadar Market" },
  { id: "v1", type: "VEHICLE", label: "MH-02 AB 1234" },
];

const DEMO_EDGES: GraphEdge[] = [
  { id: "e1", src: "p1", dst: "p2", type: "CALLED", weight: 8.0 },
  { id: "e2", src: "p1", dst: "o1", type: "SEEN_WITH", weight: 3.0 },
  { id: "e3", src: "p2", dst: "a1", type: "TRANSFERRED_TO", weight: 12.5 },
  { id: "e4", src: "p1", dst: "l1", type: "CO_LOCATED", weight: 6.0 },
  { id: "e5", src: "p2", dst: "v1", type: "SEEN_WITH", weight: 2.0 },
];

const DEMO_EVIDENCE: Record<string, EdgeEvidenceItem[]> = {
  e1: [
    {
      id: 1,
      kind: "fir_text",
      snippet: "Ravi called Suresh",
      char_start: 0,
      char_end: 18,
      page_no: 1,
      source_file_id: "file-1",
      provenance: "benchmark",
      tamper_state: "tampered",
      occurred_at: "2025-11-02T10:00:00.000Z",
      ledger_hash: "ledger-abc123",
      computed_hash: "computed-def456",
    },
    {
      id: 2,
      kind: "cdr_row",
      snippet: null,
      char_start: null,
      char_end: null,
      page_no: null,
      source_file_id: "file-2",
      provenance: "benchmark",
      tamper_state: "verified",
      occurred_at: "2025-11-03T10:00:00.000Z",
      ledger_hash: "ledger-abc123",
      computed_hash: "ledger-abc123",
    },
  ],
};

const DEMO_DETAIL: EntityDetail = {
  id: "p1",
  case_id: "demo-case",
  type: "PERSON",
  canonical_name: "Ravi Kumar",
  aliases: ["Ravi"],
  identifiers: ["9822012345"],
  relationships: [],
  associated_cases: ["demo-case"],
  case_count: 1,
  provenance: "synthetic",
  sync_state: "synced",
  notes: [],
};

export function GraphDemo(): JSX.Element {
  const [filters, setFilters] = useState<GraphFilters>(DEFAULT_FILTERS);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("p1");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);

  // No server in the demo: filtering runs client-side over the mock
  // payload with the same semantics (person-only default, weight
  // floor, explicit type expansion).
  const payload = useMemo(() => {
    const nodes = DEMO_NODES.filter((node) => filters.types.includes(node.type));
    const wanted = new Set(nodes.map((node) => node.id));
    const edges = DEMO_EDGES.filter(
      (edge) =>
        edge.weight >= filters.minWeight && wanted.has(edge.src) && wanted.has(edge.dst),
    );
    return { nodes, edges };
  }, [filters]);

  const selectedEdge = DEMO_EDGES.find((edge) => edge.id === selectedEdgeId) ?? null;
  const dateRange: DateRange = filters.dateRange;
  const [detail] = useState<EntityDetail>(DEMO_DETAIL);

  if (profileId) {
    // The profile screen fetches live data, so without a server this
    // branch exercises its loading and error states — themselves worth
    // eyeballing (design §30/§31) — rather than mock content.
    return (
      <div className="h-screen w-screen bg-[#151514]">
        <EntityProfile
          entityId={profileId}
          caseId="demo-case"
          onBack={() => setProfileId(null)}
          onOpenEntity={(entityId) => navigateWithTransition(() => setProfileId(entityId))}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen bg-[#151514] text-[#E8E5DD]">
      <div className="w-56 shrink-0 border-r border-[#30302D]">
        <GraphFilterPanel
          filters={filters}
          isolateAvailable={selectedNodeId !== null}
          resultCount={{ nodes: payload.nodes.length, edges: payload.edges.length }}
          onChange={setFilters}
        />
      </div>
      <div className="min-w-0 flex-1">
        <NetworkGraph
          caseId="demo-case"
          payload={payload}
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
        />
      </div>
      <div className="w-80 shrink-0 border-l border-[#30302D]">
        {selectedEdge ? (
          <EdgeEvidencePanel
            edge={selectedEdge}
            items={DEMO_EVIDENCE[selectedEdge.id] ?? []}
            loading={false}
            dateRange={dateRange}
            onClose={() => setSelectedEdgeId(null)}
          />
        ) : (
          <EntityDetailPanel
            detail={selectedNodeId ? detail : null}
            caseId="demo-case"
            incidentEdges={payload.edges.filter(
              (edge) => edge.src === selectedNodeId || edge.dst === selectedNodeId,
            )}
            onSelectEdge={(edgeId) => {
              setSelectedEdgeId(edgeId);
              setSelectedNodeId(null);
            }}
            onOpenProfile={(entityId) => navigateWithTransition(() => setProfileId(entityId))}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  );
}
