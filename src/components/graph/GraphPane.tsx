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

export function GraphPane() {
  const caseId = useCaseStore((s) => s.caseId) || "OP-RAVEN-01";
  const hops = useCaseStore((s) => s.hops);
  const minWeight = useCaseStore((s) => s.minWeight);
  const setMinWeight = useCaseStore((s) => s.setMinWeight);
  const setHops = useCaseStore((s) => s.setHops);
  const layerFilters = useCaseStore((s) => s.layerFilters);
  const setLayerFilter = useCaseStore((s) => s.setLayerFilter);
  const openTab = useCaseStore((s) => s.openTab);

  const [layoutName, setLayoutName] = useState<string>("cose");
  const [selectedDrawerNode, setSelectedDrawerNode] = useState<{
    id: string;
    label: string;
    type: string;
    degree: number;
    threatWeight: number;
    evidence: { logId: string; time: string; text: string }[];
  } | null>(null);

  const cyRef = useRef<Core | null>(null);

  // Fetch Macro Graph from backend
  const graphQuery = useQuery<EgoGraph>({
    queryKey: ["macro_graph", caseId, 50, minWeight],
    queryFn: async () => {
      return invokeRaven<EgoGraph>("get_macro_graph", {
        caseId,
        limit: 50,
        minWeight,
      });
    },
    staleTime: 60_000,
  });

  // Filter elements by layer toggles
  const elements = useMemo<ElementDefinition[]>(() => {
    const data = graphQuery.data;
    if (!data) return [];

    // Filter nodes based on user layer checkboxes
    const allowedTypes = new Set<string>(["PERSON"]); // People always locked ON
    if (layerFilters.vehicles) allowedTypes.add("VEHICLE");
    if (layerFilters.institutions) allowedTypes.add("ORGANIZATION");
    if (layerFilters.accounts) allowedTypes.add("ACCOUNT");
    allowedTypes.add("LOCATION");

    const validNodeIds = new Set<string>();
    const nodes: ElementDefinition[] = [];

    for (const n of data.nodes) {
      if (allowedTypes.has(n.type)) {
        validNodeIds.add(n.id);
        nodes.push({
          data: {
            id: n.id,
            label: n.label,
            type: n.type,
            w: n.degree ? Math.max(26, 26 + n.degree * 4) : 30,
          },
        });
      }
    }

    const edges: ElementDefinition[] = [];
    for (const e of data.edges) {
      if (validNodeIds.has(e.source) && validNodeIds.has(e.target)) {
        edges.push({
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            label: `${e.type} (${e.weight})`,
            w: Math.max(1.5, Math.min(6, 1 + e.weight / 15)),
          },
        });
      }
    }

    return [...nodes, ...edges];
  }, [graphQuery.data, layerFilters]);


  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || elements.length === 0) return;

    try {
      const l = cy.layout({
        name: layoutName === "cose" ? "cose" : layoutName === "circle" ? "circle" : "grid",
        animate: false,
        padding: 40,
        nodeRepulsion: () => 9000,
        idealEdgeLength: () => 100,
      });
      l.run();
    } catch {
      // layout fallback
    }

    cy.on("select", "node", (evt) => {
      const node = evt.target;
      const d = node.data();
      setSelectedDrawerNode({
        id: d.id,
        label: d.label,
        type: d.type,
        degree: 8,
        threatWeight: 35,
        evidence: [
          { logId: "LOG-8492", time: "12:44Z", text: "Direct wire transfer observed to offshore account via front entity." },
          { logId: "SIG-8811", time: "-2 days", text: "Mobile ping near suspected drop site aligned with known associates." },
        ],
      });
    });

    cy.on("unselect", "node", () => {
      // keep drawer open or optional close
    });

    return () => {
      cy.removeListener("select");
      cy.removeListener("unselect");
    };
  }, [elements, layoutName]);

  return (
    <div className="flex h-full w-full relative bg-pd-base overflow-hidden select-none">
      {/* Central Cytoscape Graph Canvas (Occupies full space) */}
      <div className="flex-1 h-full relative">
        <CytoscapeComponent
          elements={elements}
          cy={(cy: Core) => {
            cyRef.current = cy;
          }}
          className="h-full w-full"

          stylesheet={[
            {
              selector: "node",
              style: {
                label: "data(label)",
                color: "#c9d1d9",
                "font-size": 11,
                "text-valign": "bottom",
                "text-margin-y": 4,
                "border-width": 2,
                "border-color": "#30363d",
                "background-color": "#21262d",
              },
            },
            {
              selector: "node:selected",
              style: {
                "border-color": "#58a6ff",
                "border-width": 4,
                "overlay-color": "#58a6ff",
                "overlay-opacity": 0.15,
              },
            },
            {
              selector: "edge",
              style: {
                width: "data(w)",
                "line-color": "#30363d",
                "target-arrow-color": "#30363d",
                "target-arrow-shape": "triangle",
                "curve-style": "bezier",
                "font-size": 9,
                color: "#6e7681",
                label: "data(label)",
              },
            },
            {
              selector: "edge:selected",
              style: {
                "line-color": "#58a6ff",
                "target-arrow-color": "#58a6ff",
              },
            },
            ...Object.entries(TYPE_COLOR).map(([type, color]) => ({
              selector: `node[type = "${type}"]`,
              style: {
                "background-color": color,
                shape: (TYPE_SHAPE[type] || "ellipse") as never,
              },
            })),
          ]}
        />

        {/* FLOATING ANALYSIS TOOLBAR (Top-Left) */}
        <div className="absolute top-3 left-3 z-10 w-64 rounded-sm border border-pd-border bg-pd-surface/95 backdrop-blur p-3 shadow-xl space-y-3">
          <div className="flex items-center justify-between border-b border-pd-border/60 pb-1.5">
            <span className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">
              Entity Layer Filters
            </span>
            <span className="text-[10px] text-pd-accent font-mono">PDI v1.0</span>
          </div>

          {/* Layer Checkboxes */}
          <div className="space-y-1.5 text-pd-xs">
            <label className="flex items-center gap-2 text-pd-text-primary cursor-pointer">
              <input type="checkbox" checked disabled className="accent-pd-accent rounded" />
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-pd-accent" />
                People <span className="text-[10px] text-pd-text-tertiary">(Locked ON)</span>
              </span>
            </label>

            <label className="flex items-center gap-2 text-pd-text-secondary hover:text-pd-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={layerFilters.vehicles}
                onChange={(e) => setLayerFilter("vehicles", e.target.checked)}
                className="accent-pd-accent rounded"
              />
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-[#bc8cff]" />
                Vehicles
              </span>
            </label>

            <label className="flex items-center gap-2 text-pd-text-secondary hover:text-pd-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={layerFilters.institutions}
                onChange={(e) => setLayerFilter("institutions", e.target.checked)}
                className="accent-pd-accent rounded"
              />
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-[#d29922]" />
                Institutions / FIRs
              </span>
            </label>

            <label className="flex items-center gap-2 text-pd-text-secondary hover:text-pd-text-primary cursor-pointer">
              <input
                type="checkbox"
                checked={layerFilters.accounts}
                onChange={(e) => setLayerFilter("accounts", e.target.checked)}
                className="accent-pd-accent rounded"
              />
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-[#f0883e]" />
                Financial Accounts
              </span>
            </label>
          </div>

          <div className="h-px bg-pd-border/60" />

          {/* Layout & Weight Slider */}
          <div className="space-y-2 text-pd-xs">
            <div className="flex items-center justify-between">
              <span className="text-pd-text-tertiary">Layout Engine:</span>
              <select
                value={layoutName}
                onChange={(e) => setLayoutName(e.target.value)}
                className="rounded border border-pd-border bg-pd-elevated px-1.5 py-0.5 text-pd-xs text-pd-text-primary focus:outline-none"
              >
                <option value="cose">Force-Directed</option>
                <option value="circle">Circular</option>
                <option value="grid">Grid</option>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-pd-text-tertiary">Weight Floor:</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="1"
                  max="25"
                  value={minWeight}
                  onChange={(e) => setMinWeight(Number(e.target.value))}
                  className="w-16 accent-pd-accent h-1.5 bg-pd-elevated rounded"
                />
                <span className="font-mono text-pd-accent">{minWeight}</span>
              </div>
            </div>
          </div>
        </div>

        {/* CONTEXTUAL SLIDE-OUT DRAWER (When a Node is Clicked) */}
        {selectedDrawerNode && (
          <div className="absolute top-0 right-0 z-20 h-full w-72 border-l border-pd-border bg-pd-surface p-4 flex flex-col justify-between shadow-2xl animate-in slide-in-from-right duration-150">
            <div className="space-y-3.5">
              <div className="flex items-center justify-between border-b border-pd-border pb-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-pd-accent/20 text-pd-accent font-bold text-pd-xs">
                    {selectedDrawerNode.label.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-pd-sm font-semibold text-pd-text-primary leading-tight">
                      {selectedDrawerNode.label}
                    </div>
                    <div className="text-[10px] text-pd-text-tertiary font-mono">
                      {selectedDrawerNode.type}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedDrawerNode(null)}
                  className="text-pd-text-tertiary hover:text-pd-text-primary p-1"
                >
                  ✕
                </button>
              </div>

              {/* Threat Weight & Degree Metric Cards */}
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded bg-pd-base p-2 border border-pd-border">
                  <div className="text-[10px] uppercase text-pd-text-tertiary">Threat Weight</div>
                  <div className="font-mono text-pd-base font-bold text-pd-danger">
                    {selectedDrawerNode.threatWeight}.0
                  </div>
                </div>
                <div className="rounded bg-pd-base p-2 border border-pd-border">
                  <div className="text-[10px] uppercase text-pd-text-tertiary">Connections</div>
                  <div className="font-mono text-pd-base font-bold text-pd-accent">
                    {selectedDrawerNode.degree} Links
                  </div>
                </div>
              </div>

              {/* Evidence Snippets */}
              <div>
                <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary mb-1.5">
                  Intelligence Snippets
                </div>
                <div className="space-y-2 text-pd-xs">
                  {selectedDrawerNode.evidence.map((ev, i) => (
                    <div key={i} className="rounded bg-pd-base p-2.5 border-l-2 border-pd-accent bg-pd-elevated/40 space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-mono text-pd-text-tertiary">
                        <span className="text-pd-accent font-semibold">{ev.logId}</span>
                        <span>{ev.time}</span>
                      </div>
                      <div className="text-pd-text-secondary leading-relaxed">{ev.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* CTA Button: Expand to Full Profile Tab */}
            <button
              onClick={() => {
                openTab({
                  id: `profile-${selectedDrawerNode.id}`,
                  type: "profile",
                  title: `Profile: ${selectedDrawerNode.label}`,
                  data: {
                    entityId: selectedDrawerNode.id,
                    entityName: selectedDrawerNode.label,
                  },
                });
                setSelectedDrawerNode(null);
              }}
              className="flex w-full h-8.5 items-center justify-center gap-2 rounded bg-pd-accent text-pd-xs font-bold text-pd-base hover:bg-pd-accent-hover transition-colors shadow-md"
            >
              Expand Full Profile
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
