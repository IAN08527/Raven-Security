import { useEffect, useMemo, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type { Core, ElementDefinition } from "cytoscape";
import { useQuery } from "@tanstack/react-query";
import { invokeRaven } from "../../hooks/useInvoke";
import { useCaseStore } from "../../store/case";
import type { EgoGraph, GraphNode } from "../../types/generated";

const TYPE_COLOR: Record<string, string> = {
  PERSON: "#58a6ff",
  ORGANIZATION: "#d29922",
  LOCATION: "#3fb950",
  VEHICLE: "#bc8cff",
  ACCOUNT: "#f0883e",
};

const TYPE_SHAPE: Record<string, string> = {
  PERSON: "ellipse",
  ORGANIZATION: "round-rectangle",
  LOCATION: "triangle",
  VEHICLE: "diamond",
  ACCOUNT: "hexagon",
};

const KIND_COLOR: Record<string, string> = {
  fir_text: "#f85149",
  cctv_sighting: "#bc8cff",
  txn_row: "#f0883e",
  cdr_row: "#58a6ff",
};

function nodeSize(degree: number): number {
  return Math.max(24, Math.min(64, 24 + degree * 5));
}

function edgeWidth(weight: number): number {
  return Math.max(1, Math.min(6, 1 + weight / 25));
}

function buildStylesheet(): Record<string, unknown>[] {
  const styles: Record<string, unknown>[] = [
    {
      selector: "node",
      style: {
        label: "data(label)",
        color: "#c9d1d9",
        "font-size": 11,
        "text-valign": "bottom",
        "text-margin-y": 4,
        "text-wrap": "ellipsis",
        "text-max-width": "120px",
        "border-width": 2,
        "border-color": "#30363d",
        "background-color": "#21262d",
        "transition-property": "border-color, background-color, width, height",
        "transition-duration": "150ms",
      },
    },
    {
      selector: "node:selected",
      style: {
        "border-color": "#58a6ff",
        "border-width": 4,
        "overlay-color": "#58a6ff",
        "overlay-opacity": 0.15,
        "overlay-padding": 6,
      },
    },
    {
      selector: "edge",
      style: {
        width: "data(w)",
        "line-color": "#30363d",
        "target-arrow-color": "#30363d",
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.9,
        "curve-style": "bezier",
        "font-size": 9,
        color: "#6e7681",
        "text-background-color": "#0d1117",
        "text-background-opacity": 1,
        "text-background-padding": "2px",
        label: "data(type)",
      },
    },
    {
      selector: "edge:selected",
      style: {
        "line-color": "#58a6ff",
        "target-arrow-color": "#58a6ff",
        width: "data(w)",
        "z-index": 100,
      },
    },
  ];

  for (const [type, color] of Object.entries(TYPE_COLOR)) {
    styles.push({
      selector: `node[type = "${type}"]`,
      style: {
        "background-color": color,
        shape: (TYPE_SHAPE[type] as never) ?? "ellipse",
      },
    });
  }
  for (const [kind, color] of Object.entries(KIND_COLOR)) {
    styles.push({
      selector: `edge[kind = "${kind}"]`,
      style: { "line-color": color, "target-arrow-color": color },
    });
  }
  return styles;
}

const LAYOUTS = ["fcose", "cose-bilkent", "circle", "grid"] as const;
type LayoutName = (typeof LAYOUTS)[number];

export function GraphPane() {
  const caseId = useCaseStore((s) => s.caseId);
  const viewMode = useCaseStore((s) => s.viewMode);
  const setViewMode = useCaseStore((s) => s.setViewMode);
  const centerEntityId = useCaseStore((s) => s.centerEntityId);
  const setCenterEntity = useCaseStore((s) => s.setCenterEntity);
  const minWeight = useCaseStore((s) => s.minWeight);
  const setMinWeight = useCaseStore((s) => s.setMinWeight);
  const hops = useCaseStore((s) => s.hops);
  const setHops = useCaseStore((s) => s.setHops);
  const selectEntity = useCaseStore((s) => s.selectEntity);
  const selectEdge = useCaseStore((s) => s.selectEdge);
  const selectedEntityId = useCaseStore((s) => s.selectedEntityId);
  const selectedEdgeId = useCaseStore((s) => s.selectedEdgeId);

  const [layout, setLayout] = useState<LayoutName>("fcose");
  const [showLegend, setShowLegend] = useState(true);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<GraphNode[]>([]);
  const cyRef = useRef<Core | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<EgoGraph>({
    queryKey: ["graph", viewMode, caseId, centerEntityId, minWeight, hops, layout],
    queryFn: () =>
      viewMode === "macro"
        ? invokeRaven<EgoGraph>("get_macro_graph", {
            case_id: caseId,
            min_weight: minWeight,
            limit: 1000,
          })
        : invokeRaven<EgoGraph>("get_ego_graph", {
            entity_id: centerEntityId || selectedEntityId || "89c5881e-787a-51e8-b48b-de282ff2fc96",
            hops,
            min_weight: minWeight,
          }),
  });

  const elements: ElementDefinition[] = useMemo(() => {
    if (!data) return [];
    const nodes: ElementDefinition[] = data.nodes.map((n) => ({
      data: {
        id: n.id,
        label: n.label,
        type: n.type,
        risk: n.risk_score,
        degree: n.degree,
      },
    }));
    const edges: ElementDefinition[] = data.edges.map((e) => ({
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
        weight: e.weight,
        kind: e.dominant_kind ?? "default",
        w: edgeWidth(e.weight),
        ev: e.evidence_count,
      },
    }));
    return [...nodes, ...edges];
  }, [data]);

  const stylesheet = useMemo(() => buildStylesheet(), []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || elements.length === 0) return;
    try {
      cy.layout(
        layout === "fcose"
          ? ({ name: "fcose", randomize: false, animate: true } as never)
          : layout === "cose-bilkent"
          ? ({ name: "cose-bilkent", randomize: false, animate: true } as never)
          : ({ name: layout, animate: true } as never),
      ).run();
    } catch (e) {
      console.warn("Cytoscape layout error:", e);
      try {
        cy.layout({ name: "cose", animate: true } as never).run();
      } catch {
        cy.layout({ name: "grid", animate: true } as never).run();
      }
    }
  }, [elements, layout]);

  // Keep the selected element highlighted in the canvas.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().unselect();
    if (selectedEntityId) cy.$id(selectedEntityId).select();
    if (selectedEdgeId) cy.$id(selectedEdgeId).select();
  }, [selectedEntityId, selectedEdgeId, elements]);

  const onSearch = async (q: string) => {
    setSearch(q);
    if (!q) {
      setSearchResults([]);
      return;
    }
    const all = await invokeRaven<GraphNode[]>("list_entities", { case_id: caseId });
    setSearchResults(all.filter((n) => n.label.toLowerCase().includes(q.toLowerCase())).slice(0, 8));
  };

  const pickEntity = (id: string) => {
    setCenterEntity(id);
    setViewMode("micro");
    setSearch("");
    setSearchResults([]);
  };

  const onSwitchToMicro = () => {
    if (!centerEntityId) {
      if (selectedEntityId) {
        setCenterEntity(selectedEntityId);
      } else if (data?.nodes && data.nodes.length > 0) {
        setCenterEntity(data.nodes[0].id);
      }
    }
    setViewMode("micro");
  };

  const source = data?.source ?? "";

  return (
    <div className="relative h-full bg-pd-base">
      {/* Floating toolbar */}
      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2 rounded-pd-md border border-pd-border bg-pd-surface/95 p-1.5 text-pd-sm shadow-pd">
        <div className="flex overflow-hidden rounded-pd-sm border border-pd-border">
          <button
            className={`px-2.5 py-1 ${viewMode === "macro" ? "bg-pd-accent/20 text-pd-accent" : "text-pd-text-secondary hover:bg-pd-elevated"}`}
            onClick={() => setViewMode("macro")}
          >
            Macro
          </button>
          <button
            className={`px-2.5 py-1 ${viewMode === "micro" ? "bg-pd-accent/20 text-pd-accent" : "text-pd-text-secondary hover:bg-pd-elevated"}`}
            onClick={onSwitchToMicro}
          >
            Micro
          </button>
        </div>

        {viewMode === "micro" && (
          <div className="flex items-center gap-1 text-pd-text-secondary">
            <span>hops</span>
            <button className="h-5 w-5 rounded-pd-sm border border-pd-border" onClick={() => setHops(Math.max(1, hops - 1))}>
              −
            </button>
            <span className="w-4 text-center text-pd-text-primary">{hops}</span>
            <button className="h-5 w-5 rounded-pd-sm border border-pd-border" onClick={() => setHops(Math.min(3, hops + 1))}>
              +
            </button>
          </div>
        )}

        <div className="flex items-center gap-1 text-pd-text-secondary">
          <span>min&nbsp;w</span>
          <input
            type="range"
            min={0}
            max={100}
            value={minWeight}
            onChange={(e) => setMinWeight(Number(e.target.value))}
            className="w-24 accent-pd-accent"
          />
          <span className="w-7 text-right text-pd-text-primary">{minWeight}</span>
        </div>

        <select
          value={layout}
          onChange={(e) => setLayout(e.target.value as LayoutName)}
          className="rounded-pd-sm border border-pd-border bg-pd-elevated px-1 py-0.5 text-pd-text-primary"
        >
          {LAYOUTS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>

        <button className="rounded-pd-sm px-2 py-1 text-pd-text-secondary hover:bg-pd-elevated" onClick={() => refetch()}>
          ⟳
        </button>

        <button className="rounded-pd-sm px-2 py-1 text-pd-text-secondary hover:bg-pd-elevated" onClick={() => setShowLegend((v) => !v)}>
          legend
        </button>
      </div>

      {/* Search */}
      <div className="absolute right-3 top-3 z-10 w-56">
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Find entity…"
          className="w-full rounded-pd-sm border border-pd-border bg-pd-surface px-2 py-1 text-pd-sm text-pd-text-primary placeholder:text-pd-text-tertiary"
        />
        {searchResults.length > 0 && (
          <div className="mt-1 overflow-hidden rounded-pd-sm border border-pd-border bg-pd-surface">
            {searchResults.map((n) => (
              <button
                key={n.id}
                onClick={() => pickEntity(n.id)}
                className="block w-full px-2 py-1 text-left text-pd-sm text-pd-text-primary hover:bg-pd-elevated"
              >
                <span style={{ color: TYPE_COLOR[n.type] ?? "#c9d1d9" }}>{n.label}</span>
                <span className="ml-1 text-pd-xs text-pd-text-tertiary">{n.type}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Source badge */}
      {source && (
        <div className="absolute bottom-3 right-3 z-10 rounded-pd-sm border border-pd-border bg-pd-surface px-2 py-0.5 text-pd-xs text-pd-text-tertiary">
          source: <span className={source === "mock" ? "text-pd-warning" : "text-pd-success"}>{source}</span>
        </div>
      )}

      {/* Legend */}
      {showLegend && (
        <div className="absolute bottom-3 left-3 z-10 rounded-pd-md border border-pd-border bg-pd-surface/95 p-2 text-pd-xs">
          <div className="mb-1 text-pd-text-tertiary">Entities</div>
          {Object.entries(TYPE_COLOR).map(([t, c]) => (
            <div key={t} className="flex items-center gap-1.5 py-0.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />
              <span className="text-pd-text-secondary">{t}</span>
            </div>
          ))}
          <div className="mb-1 mt-2 text-pd-text-tertiary">Evidence</div>
          {Object.entries(KIND_COLOR).map(([k, c]) => (
            <div key={k} className="flex items-center gap-1.5 py-0.5">
              <span className="inline-block h-0.5 w-4" style={{ background: c }} />
              <span className="text-pd-text-secondary">{k}</span>
            </div>
          ))}
        </div>
      )}

      {/* Canvas */}
      {isError ? (
        <div className="flex h-full items-center justify-center text-pd-sm text-pd-danger">
          Graph store unreachable. Start the engine or the Tauri app.
        </div>
      ) : isLoading ? (
        <div className="flex h-full items-center justify-center text-pd-sm text-pd-text-secondary">
          Loading {viewMode} graph…
        </div>
      ) : elements.length === 0 ? (
        <div className="flex h-full items-center justify-center text-pd-sm text-pd-text-tertiary">
          No nodes above weight floor {minWeight}. Lower the slider.
        </div>
      ) : (
        <CytoscapeComponent
          elements={elements}
          stylesheet={stylesheet}
          style={{ width: "100%", height: "100%" }}
          cy={(cy: Core) => {
            cyRef.current = cy;
            cy.on("tap", "node", (evt: any) => {
              const id = evt.target.id();
              selectEntity(id);
              if (viewMode === "macro") {
                setCenterEntity(id);
                setViewMode("micro");
              }
            });
            cy.on("tap", "edge", (evt: any) => selectEdge(evt.target.id()));
            cy.on("tap", (evt: any) => {
              if (evt.target === cy) {
                selectEntity(null);
                selectEdge(null);
              }
            });
          }}
        />
      )}
    </div>
  );
}
