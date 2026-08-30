import { useQuery } from "@tanstack/react-query";
import { invokeRaven } from "../../hooks/useInvoke";
import { useCaseStore } from "../../store/case";
import type { EdgeEvidence, EntityDetails } from "../../types/generated";

const KIND_COLOR: Record<string, string> = {
  fir_text: "#f85149",
  cctv_sighting: "#bc8cff",
  txn_row: "#f0883e",
  cdr_row: "#58a6ff",
};

function EvidenceList({ evidence }: { evidence: EdgeEvidence["evidence"] }) {
  if (evidence.length === 0) {
    return <div className="text-pd-sm text-pd-text-tertiary">No evidence rows.</div>;
  }
  return (
    <div className="space-y-2">
      {evidence.map((e) => (
        <div key={e.id} className="rounded-pd-sm border border-pd-border bg-pd-elevated p-2">
          <div className="flex items-center justify-between">
            <span
              className="rounded-pd-sm px-1.5 py-0.5 text-pd-xs uppercase"
              style={{ color: KIND_COLOR[e.kind] ?? "#8b949e", background: "rgba(255,255,255,0.04)" }}
            >
              {e.kind}
            </span>
            {e.page_no != null && <span className="text-pd-xs text-pd-text-tertiary">p.{e.page_no}</span>}
          </div>
          <div className="mt-1 text-pd-base text-pd-text-primary">{e.snippet}</div>
          {e.char_start != null && e.char_end != null && (
            <div className="text-pd-xs text-pd-text-tertiary">
              span {e.char_start}–{e.char_end}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function EvidencePane() {
  const selectedEdge = useCaseStore((s) => s.selectedEdgeId);
  const selectedEntity = useCaseStore((s) => s.selectedEntityId);

  const edgeQ = useQuery<EdgeEvidence>({
    queryKey: ["evidence", selectedEdge],
    enabled: !!selectedEdge,
    queryFn: () => invokeRaven<EdgeEvidence>("get_edge_evidence", { rel_id: selectedEdge }),
  });

  const nodeQ = useQuery<EntityDetails>({
    queryKey: ["entity", selectedEntity],
    enabled: !!selectedEntity && !selectedEdge,
    queryFn: () => invokeRaven<EntityDetails>("get_entity_details", { entity_id: selectedEntity }),
  });

  if (!selectedEdge && !selectedEntity) {
    return (
      <div className="p-4 text-pd-sm text-pd-text-tertiary">
        Select a node or edge to view provenance.
      </div>
    );
  }

  if (selectedEdge) {
    const rel = edgeQ.data?.relationship;
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-pd-border px-3 py-2 text-pd-md">Edge</div>
        <div className="flex-1 overflow-y-auto p-3">
          {rel && (
            <div className="mb-3 rounded-pd-sm border border-pd-border bg-pd-elevated p-2">
              <div className="text-pd-base text-pd-text-primary">
                <span className="text-pd-accent">{rel.src_name}</span>
                <span className="mx-1 text-pd-text-tertiary">—{rel.type}→</span>
                <span className="text-pd-accent">{rel.dst_name}</span>
              </div>
              <div className="mt-1 flex gap-3 text-pd-xs text-pd-text-tertiary">
                <span>weight {rel.weight.toFixed(1)}</span>
                <span>{rel.evidence_count} evidence</span>
              </div>
            </div>
          )}
          <div className="mb-1 text-pd-xs uppercase text-pd-text-tertiary">Evidence</div>
          {edgeQ.isLoading ? (
            <div className="text-pd-sm text-pd-text-secondary">Loading…</div>
          ) : (
            <EvidenceList evidence={edgeQ.data?.evidence ?? []} />
          )}
          {edgeQ.data && edgeQ.data.source_files.length > 0 && (
            <>
              <div className="mb-1 mt-3 text-pd-xs uppercase text-pd-text-tertiary">Source files</div>
              {edgeQ.data.source_files.map((f) => (
                <div key={f.id} className="rounded-pd-sm border border-pd-border bg-pd-elevated p-2 text-pd-sm">
                  <div className="text-pd-text-primary">{f.filename}</div>
                  <div className="text-pd-xs text-pd-text-tertiary">status: {f.status}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    );
  }

  const ent = nodeQ.data?.entity;
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-pd-border px-3 py-2 text-pd-md">Entity</div>
      <div className="flex-1 overflow-y-auto p-3">
        {ent && (
          <div className="mb-3 rounded-pd-sm border border-pd-border bg-pd-elevated p-2">
            <div className="text-pd-base text-pd-text-primary">{ent.label}</div>
            <div className="mt-1 flex gap-2 text-pd-xs text-pd-text-tertiary">
              <span className="rounded-pd-sm bg-pd-accent/15 px-1.5 py-0.5 text-pd-accent">{ent.type}</span>
              <span>risk {ent.risk_score.toFixed(2)}</span>
              <span>degree {ent.degree}</span>
            </div>
          </div>
        )}
        {nodeQ.data && nodeQ.data.identifiers.length > 0 && (
          <>
            <div className="mb-1 text-pd-xs uppercase text-pd-text-tertiary">Identifiers</div>
            <div className="mb-3 space-y-1">
              {nodeQ.data.identifiers.map((i, idx) => (
                <div key={idx} className="flex gap-2 rounded-pd-sm border border-pd-border bg-pd-elevated px-2 py-1 text-pd-sm">
                  <span className="text-pd-text-tertiary">{i.itype}</span>
                  <span className="text-pd-text-primary">{i.value}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="mb-1 text-pd-xs uppercase text-pd-text-tertiary">Evidence</div>
        {nodeQ.isLoading ? (
          <div className="text-pd-sm text-pd-text-secondary">Loading…</div>
        ) : (
          <EvidenceList evidence={nodeQ.data?.evidence ?? []} />
        )}
      </div>
    </div>
  );
}
