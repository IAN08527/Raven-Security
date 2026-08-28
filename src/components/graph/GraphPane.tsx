import { useMemo } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import { useCaseStore } from "../../store/case";
import { useQuery } from "@tanstack/react-query";
import { invokeRaven } from "../../hooks/useInvoke";
import type { EgoGraph } from "../../types/generated";

export function GraphPane() {
  const caseId = useCaseStore((s) => s.caseId);
  const selected = useCaseStore((s) => s.selectedEntityId);
  const selectEntity = useCaseStore((s) => s.selectEntity);

  const { data } = useQuery<EgoGraph>({
    queryKey: ["macro", caseId],
    queryFn: () =>
      invokeRaven<EgoGraph>("get_macro_graph", { case_id: caseId, min_weight: 5, limit: 1000 }),
  });

  const elements = useMemo(() => {
    if (!data) return [];
    return [
      ...data.nodes.map((n) => ({ data: { id: n.id, label: n.label } })),
      ...data.edges.map((e) => ({
        data: { id: e.id, source: e.source, target: e.target, weight: e.weight },
      })),
    ];
  }, [data]);

  return (
    <div className="relative h-full bg-pd-base">
      <div className="absolute left-3 top-3 z-10 flex gap-2 rounded-pd-md border border-pd-border bg-pd-surface p-1">
        <button className="rounded-pd-sm bg-pd-accent/15 px-2 py-1 text-pd-sm text-pd-accent">
          Macro
        </button>
        <button className="rounded-pd-sm px-2 py-1 text-pd-sm text-pd-text-secondary hover:bg-pd-elevated">
          Micro (2-hop)
        </button>
      </div>
      <CytoscapeComponent
        elements={elements}
        style={{ width: "100%", height: "100%" }}
        layout={{ name: "fcose", randomize: false } as never}
        stylesheet={[
          {
            selector: "node",
            style: {
              "background-color": "#21262d",
              label: "data(label)",
              color: "#c9d1d9",
              "font-size": 11,
              "border-width": 2,
              "border-color": "#58a6ff",
            },
          },
          {
            selector: "edge",
            style: {
              width: 2,
              "line-color": "#30363d",
              "target-arrow-color": "#30363d",
              "target-arrow-shape": "triangle",
            },
          },
        ]}
        cy={(cy) =>
          cy.on("tap", "node", (evt) => selectEntity(evt.target.id()))
        }
      />
    </div>
  );
}
