import { useQuery } from "@tanstack/react-query";
import { invokeRaven } from "../../hooks/useInvoke";
import { useCaseStore } from "../../store/case";
import type { EdgeEvidence } from "../../types/generated";

export function EvidencePane() {
  const selectedEdge = useCaseStore((s) => s.selectedEdgeId);

  const { data } = useQuery<EdgeEvidence>({
    queryKey: ["evidence", selectedEdge],
    enabled: !!selectedEdge,
    queryFn: () => invokeRaven<EdgeEvidence>("get_edge_evidence", { rel_id: selectedEdge }),
  });

  if (!selectedEdge) {
    return (
      <div className="p-4 text-pd-sm text-pd-text-tertiary">
        Select a node or edge to view provenance.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-pd-border px-3 py-2 text-pd-md">Evidence</div>
      <div className="flex-1 overflow-y-auto p-3">
        {data?.evidence.map((e) => (
          <div key={e.id} className="mb-2 rounded-pd-sm border border-pd-border bg-pd-elevated p-2">
            <div className="text-pd-xs uppercase text-pd-text-tertiary">{e.kind}</div>
            <div className="mt-1 text-pd-base text-pd-text-primary">{e.snippet}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
