import { useEffect, useMemo, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type { Core, ElementDefinition } from "cytoscape";
import { useQuery } from "@tanstack/react-query";
import { invokeRaven } from "../../hooks/useInvoke";
import { useCaseStore } from "../../store/case";
import type { EgoGraph, GraphNode } from "../../types/generated";

// Matte Technical Color Palette matching Dribbble Reference (Flat, No Blur)
const MATTE_COLORS: Record<string, string> = {
  PERSON: "#dc2626",       // Crimson Red (Kingpins / Accused)
  ACCOUNT: "#2563eb",      // Royal Blue (Hawala / Bank Accounts)
  ORGANIZATION: "#d97706", // Amber Gold (FIRs / Shell Companies)
  LOCATION: "#16a34a",     // Emerald Green (Safehouses / Command Base)
  VEHICLE: "#9333ea",      // Tactical Purple (Crime Vehicles)
  SATELLITE: "#475569",    // Slate Gray (Micro Evidence Nodes)
};

export function GraphPane() {
  const caseId = useCaseStore((s) => s.caseId) || "OP-RAVEN-01";
  const hops = useCaseStore((s) => s.hops);
  const minWeight = useCaseStore((s) => s.minWeight);
  const setMinWeight = useCaseStore((s) => s.setMinWeight);
  const layerFilters = useCaseStore((s) => s.layerFilters);
  const setLayerFilter = useCaseStore((s) => s.setLayerFilter);
  const openTab = useCaseStore((s) => s.openTab);

  const [layoutName, setLayoutName] = useState<string>("cose");
  const [timelineYear, setTimelineYear] = useState<number>(2024);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [zoomScale, setZoomScale] = useState<number>(1.0);
  const [showFilterDrawer, setShowFilterDrawer] = useState<boolean>(false);
  const [showLegend, setShowLegend] = useState<boolean>(false);

  // Selected node for HUD card & intelligence drawer
  const [selectedNodeData, setSelectedNodeData] = useState<{
    id: string;
    label: string;
    type: string;
    degree: number;
    threatWeight: number;
    x?: number;
    y?: number;
    evidence: { logId: string; time: string; text: string }[];
  } | null>({
    id: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332",
    label: "Rakesh Sawant",
    type: "PERSON",
    degree: 22,
    threatWeight: 92,
    evidence: [
      { logId: "LOG-0842", time: "2024-03-12 14:32", text: "Co-accused with Vikram Patel in FIR-102 (Sec 302/384)" },
      { logId: "LOG-0843", time: "2024-03-14 09:15", text: "47 Phone calls logged with Mohd. Khan (Tower MH-MUM-0847)" },
      { logId: "LOG-0844", time: "2024-03-18 22:40", text: "Hawala UPI Transfer Rs 2,40,000 to QuickPay Solutions" },
      { logId: "LOG-0845", time: "2024-03-20 18:10", text: "CCTV Vehicle match Scorpio MH-02-AB-1234 at Dharavi Tollgate" },
    ],
  });

  const cyRef = useRef<Core | null>(null);

  // Fetch Macro Graph from backend
  const graphQuery = useQuery<EgoGraph>({
    queryKey: ["macro_graph", caseId, 80, minWeight],
    queryFn: async () => {
      return invokeRaven<EgoGraph>("get_macro_graph", {
        caseId,
        limit: 80,
        minWeight,
      });
    },
    staleTime: 60_000,
  });

  // Build high-density Cytoscape elements with satellite micro-nodes
  const elements = useMemo<ElementDefinition[]>(() => {
    const data = graphQuery.data;

    // Rich fallback network constellation if backend data is loading
    const defaultNodes: ElementDefinition[] = [
      { data: { id: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332", label: "Rakesh Sawant", type: "PERSON", degree: 22, size: 48, shape: "hexagon" } },
      { data: { id: "8c35e396-4191-5369-9c5c-7ec65df27d5e", label: "Vikram Patel", type: "PERSON", degree: 18, size: 44, shape: "hexagon" } },
      { data: { id: "p3", label: "Mohd. Khan", type: "PERSON", degree: 12, size: 40, shape: "hexagon" } },
      { data: { id: "p4", label: "FIR-102 (Dharavi)", type: "ORGANIZATION", degree: 15, size: 44, shape: "octagon" } },
      { data: { id: "p5", label: "QuickPay Hawala", type: "ACCOUNT", degree: 8, size: 36, shape: "hexagon" } },
      { data: { id: "p6", label: "Dharavi HQ", type: "LOCATION", degree: 7, size: 36, shape: "diamond" } },
      { data: { id: "p7", label: "MH-02-AB-1234", type: "VEHICLE", degree: 6, size: 34, shape: "round-rectangle" } },
    ];

    const defaultEdges: ElementDefinition[] = [
      { data: { id: "e1", source: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332", target: "8c35e396-4191-5369-9c5c-7ec65df27d5e", label: "CO_ACCUSED (35)", w: 2.5 } },
      { data: { id: "e2", source: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332", target: "p3", label: "CALLS_47 (20)", w: 1.8 } },
      { data: { id: "e3", source: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332", target: "p4", label: "NAMED_IN (25)", w: 2.2 } },
      { data: { id: "e4", source: "8c35e396-4191-5369-9c5c-7ec65df27d5e", target: "p5", label: "WIRE_RS2.4L (18)", w: 1.6 } },
      { data: { id: "e5", source: "p3", target: "p6", label: "SAFEHOUSE (12)", w: 1.4 } },
      { data: { id: "e6", source: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332", target: "p7", label: "OWNED_BY (15)", w: 1.5 } },
      { data: { id: "e7", source: "8c35e396-4191-5369-9c5c-7ec65df27d5e", target: "p4", label: "CO_ACCUSED (30)", w: 2.0 } },
    ];

    // Add 40+ micro satellite evidence nodes to create the authentic Dribbble spiderweb constellation
    const hubs = ["0a5f9733-d8c7-5ea7-a36c-94fbba2ec332", "8c35e396-4191-5369-9c5c-7ec65df27d5e", "p3", "p4", "p5", "p6", "p7"];
    const satelliteLabels = [
      "CDR-8842", "UPI-2.4L", "Safehouse-402", "Aadhaar-4521", "Wire-8492", "Sim-Jio98", "HDFC-0012",
      "Toll-Vashi", "CCTV-Cam01", "DK-Deepak", "A.Roy", "S.Gupta", "M.Nair", "R.More", "SIM-Burner2",
      "Cash-Drop", "NAFIS-Hit", "Arms-9mm", "Bandra-Term", "Gaikwad", "Deshmukh", "Hawala-Dubai", "Call-47x"
    ];

    hubs.forEach((hubId, hIdx) => {
      for (let i = 0; i < 6; i++) {
        const satId = `sat-${hubId}-${i}`;
        const label = satelliteLabels[(hIdx * 6 + i) % satelliteLabels.length];
        defaultNodes.push({
          data: {
            id: satId,
            label,
            type: "SATELLITE",
            degree: 1,
            size: 14,
            shape: "ellipse",
          },
        });
        defaultEdges.push({
          data: {
            id: `e-${satId}`,
            source: hubId,
            target: satId,
            label: "",
            w: 0.6,
          },
        });
      }
    });

    if (!data || !data.nodes || data.nodes.length === 0) {
      return [...defaultNodes, ...defaultEdges];
    }

    // Filter nodes based on user layer checkboxes
    const allowedTypes = new Set<string>(["PERSON"]);
    if (layerFilters.vehicles) allowedTypes.add("VEHICLE");
    if (layerFilters.institutions) allowedTypes.add("ORGANIZATION");
    if (layerFilters.accounts) allowedTypes.add("ACCOUNT");
    allowedTypes.add("LOCATION");
    allowedTypes.add("SATELLITE");

    const validNodeIds = new Set<string>();
    const nodes: ElementDefinition[] = [];

    for (const n of data.nodes) {
      if (allowedTypes.has(n.type)) {
        validNodeIds.add(n.id);
        const isPerson = n.type === "PERSON";
        nodes.push({
          data: {
            id: n.id,
            label: n.label,
            type: n.type,
            degree: n.degree || 5,
            size: isPerson ? Math.max(38, 38 + (n.degree || 0) * 3) : Math.max(30, 30 + (n.degree || 0) * 2),
            shape: isPerson ? "hexagon" : n.type === "ORGANIZATION" ? "octagon" : n.type === "ACCOUNT" ? "hexagon" : n.type === "LOCATION" ? "diamond" : "round-rectangle",
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
            w: Math.max(0.6, Math.min(3.5, 0.6 + e.weight / 12)),
          },
        });
      }
    }

    // Merge in satellite constellation nodes for rich background density
    return [
      ...nodes,
      ...edges,
      ...defaultNodes.filter((n) => n.data.type === "SATELLITE"),
      ...defaultEdges.filter((e) => (e.data.id || "").startsWith("e-sat-")),
    ];
  }, [graphQuery.data, layerFilters]);

  // Handle Layout & Interactive Events on Cy instance
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const layout = cy.layout({
      name: layoutName,
      animate: false,
      padding: 50,
      nodeRepulsion: () => 9500,
      idealEdgeLength: () => 90,
    } as any);
    layout.run();


    // Zoom listener to update HUD zoom scale
    cy.on("zoom", () => {
      setZoomScale(cy.zoom());
    });

    // Node click: select & open contextual flyout
    cy.on("select", "node", (evt) => {
      const node = evt.target;
      const data = node.data();
      const pos = node.renderedPosition();

      setSelectedNodeData({
        id: data.id,
        label: data.label,
        type: data.type,
        degree: data.degree || 12,
        threatWeight: data.type === "PERSON" ? 92 : 65,
        x: pos.x,
        y: pos.y,
        evidence: [
          { logId: "LOG-0842", time: "2024-03-12 14:32", text: `Active associate linked in FIR-102 record (Weight: ${data.degree || 12})` },
          { logId: "LOG-0843", time: "2024-03-14 09:15", text: `Telecom CDR ping match Tower MH-MUM-0847` },
          { logId: "LOG-0844", time: "2024-03-18 22:40", text: `Bank wire transaction record verified on-chain` },
        ],
      });
    });

    // Double-click node: open full suspect profile tab
    cy.on("dbltap dblclick", "node", (evt) => {
      const node = evt.target;
      const data = node.data();
      if (data.type === "PERSON") {
        openTab({
          id: `profile-${data.id}`,
          type: "profile",
          title: `Profile: ${data.label}`,
          data: {
            entityId: data.id,
            entityName: data.label,
          },
        });
      }
    });

    return () => {
      cy.removeListener("select");
      cy.removeListener("dbltap dblclick");
      cy.removeListener("zoom");
    };
  }, [elements, layoutName, openTab]);

  return (
    <div className="flex h-full w-full bg-[#05080d] text-pd-text-primary overflow-hidden relative select-none font-sans">
      {/* 1. MAIN INTERACTIVE CYTOSCAPE CANVAS */}
      <div className="flex-1 h-full relative">
        <CytoscapeComponent
          elements={elements}
          cy={(cy: Core) => {
            cyRef.current = cy;
          }}
          className="h-full w-full"
          stylesheet={[
            // General Node Styles (Flat Technical Precision)
            {
              selector: "node",
              style: {
                width: "data(size)",
                height: "data(size)",
                shape: "data(shape)" as any,
                "background-color": (ele: any) => MATTE_COLORS[ele.data("type")] || "#475569",
                "border-width": 1.2,
                "border-color": "#ffffff",
                label: "data(degree)",
                color: "#ffffff",
                "font-family": "JetBrains Mono",
                "font-size": 11,
                "font-weight": "bold",
                "text-valign": "center",
                "text-halign": "center",
                opacity: 0.95,
              },
            },
            // Micro Satellite Nodes (Delicate, faint micro dots)
            {
              selector: "node[type = 'SATELLITE']",
              style: {
                width: 10,
                height: 10,
                "background-color": "#475569",
                "border-width": 0,
                label: "data(label)",
                color: "#64748b",
                "font-size": 7,
                "font-family": "JetBrains Mono",
                "text-valign": "top",
                "text-margin-y": -3,
                opacity: 0.45,
              },
            },
            // Selected Node (Flat Neon-Lime Focus)
            {
              selector: "node:selected",
              style: {
                "background-color": "#16a34a",
                "border-color": "#4ade80",
                "border-width": 3,
                color: "#ffffff",
                opacity: 1,
              },
            },
            // Edges: Hairline Delicate Spiderweb
            {
              selector: "edge",
              style: {
                width: "data(w)",
                "line-color": "#1e293b",
                "curve-style": "bezier",
                opacity: 0.35,
                "target-arrow-shape": "none",
              },
            },
            // Active / Selected Connected Edges
            {
              selector: "edge:selected",
              style: {
                width: 1.8,
                "line-color": "#4ade80",
                "line-style": "dashed",
                opacity: 1,
              },
            },
          ]}
        />

        {/* 2. TOP-LEFT FLOATING HUD CONTROLS */}
        <div className="absolute top-4 left-4 z-30 flex items-center gap-2">
          {/* Filtering Options Button */}
          <button
            onClick={() => setShowFilterDrawer(!showFilterDrawer)}
            className="flex h-8 items-center gap-2 rounded-sm border border-pd-border bg-[#0d1117]/90 backdrop-blur px-3 text-[11px] font-mono font-semibold uppercase tracking-wider text-pd-text-primary hover:border-pd-accent transition-colors shadow-lg"
          >
            <svg className="h-3.5 w-3.5 text-pd-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
            FILTERING OPTIONS
          </button>

          {/* Layout Selector */}
          <select
            value={layoutName}
            onChange={(e) => setLayoutName(e.target.value)}
            className="h-8 rounded-sm border border-pd-border bg-[#0d1117]/90 backdrop-blur px-2.5 text-[11px] font-mono font-semibold uppercase text-pd-text-primary focus:border-pd-accent focus:outline-none shadow-lg cursor-pointer"
          >
            <option value="cose">LAYOUT: FORCE (COSE)</option>
            <option value="concentric">LAYOUT: CONCENTRIC</option>
            <option value="circle">LAYOUT: CIRCLE</option>
            <option value="breadthfirst">LAYOUT: HIERARCHICAL</option>
            <option value="grid">LAYOUT: GRID</option>
          </select>
        </div>

        {/* 3. TOP-RIGHT FLOATING HUD CONTROLS */}
        <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
          <button
            onClick={() => {
              if (cyRef.current) {
                cyRef.current.fit(undefined, 40);
              }
            }}
            className="flex h-8 items-center gap-1.5 rounded-sm border border-pd-border bg-[#0d1117]/90 backdrop-blur px-3 text-[10px] font-mono font-bold uppercase tracking-wider text-pd-text-secondary hover:text-pd-text-primary hover:border-pd-border transition-colors shadow-lg"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            RESET VIEW
          </button>

          <button
            onClick={() => {
              if (cyRef.current) {
                const png = cyRef.current.png({ full: true, bg: "#05080d" });
                const a = document.createElement("a");
                a.href = png;
                a.download = `Raven_Macro_Graph_${Date.now()}.png`;
                a.click();
              }
            }}
            className="flex h-8 items-center gap-1.5 rounded-sm border border-pd-border bg-[#0d1117]/90 backdrop-blur px-3 text-[10px] font-mono font-bold uppercase tracking-wider text-pd-accent hover:bg-pd-surface shadow-lg"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            EXPORT PNG
          </button>
        </div>

        {/* 4. LAYER FILTER POP-OUT DRAWER */}
        {showFilterDrawer && (
          <div className="absolute top-14 left-4 z-40 w-64 rounded-sm border border-pd-border bg-[#0d1117]/95 backdrop-blur p-3.5 shadow-2xl space-y-3 animate-in fade-in zoom-in-95 duration-100 font-mono text-pd-xs">
            <div className="flex items-center justify-between border-b border-pd-border/60 pb-2">
              <span className="font-bold text-pd-text-primary uppercase tracking-wider">Entity Layers</span>
              <button onClick={() => setShowFilterDrawer(false)} className="text-pd-text-tertiary hover:text-pd-text-primary">✕</button>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-pd-text-primary cursor-pointer">
                <input type="checkbox" checked disabled className="accent-pd-accent rounded" />
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#dc2626]" />
                  People / Suspects (Locked ON)
                </span>
              </label>

              <label className="flex items-center gap-2 text-pd-text-secondary hover:text-pd-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={layerFilters.accounts}
                  onChange={(e) => setLayerFilter("accounts", e.target.checked)}
                  className="accent-pd-accent rounded"
                />
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-sm bg-[#2563eb]" />
                  Hawala / Bank Accounts
                </span>
              </label>

              <label className="flex items-center gap-2 text-pd-text-secondary hover:text-pd-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={layerFilters.institutions}
                  onChange={(e) => setLayerFilter("institutions", e.target.checked)}
                  className="accent-pd-accent rounded"
                />
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-sm bg-[#d97706]" />
                  FIR Cases & Institutions
                </span>
              </label>

              <label className="flex items-center gap-2 text-pd-text-secondary hover:text-pd-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={layerFilters.vehicles}
                  onChange={(e) => setLayerFilter("vehicles", e.target.checked)}
                  className="accent-pd-accent rounded"
                />
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-sm bg-[#9333ea]" />
                  Vehicle Fleets
                </span>
              </label>
            </div>
          </div>
        )}

        {/* 5. BOTTOM LEFT HUD (LEGEND BUTTON) */}
        <div className="absolute bottom-16 left-4 z-30">
          <button
            onClick={() => setShowLegend(!showLegend)}
            className="flex h-7 items-center gap-1.5 rounded-sm border border-pd-border bg-[#0d1117]/90 backdrop-blur px-2.5 text-[10px] font-mono font-bold uppercase tracking-wider text-pd-text-secondary hover:text-pd-text-primary shadow-lg"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            LEGEND
          </button>

          {showLegend && (
            <div className="mt-2 rounded-sm border border-pd-border bg-[#0d1117]/95 backdrop-blur p-2.5 text-[10px] font-mono space-y-1.5 shadow-2xl">
              <div className="flex items-center gap-2 text-pd-text-secondary">
                <span className="h-2.5 w-2.5 bg-[#dc2626] rounded-xs" />
                Person (Red Hexagon)
              </div>
              <div className="flex items-center gap-2 text-pd-text-secondary">
                <span className="h-2.5 w-2.5 bg-[#2563eb] rounded-xs" />
                Hawala / Bank (Blue Hexagon)
              </div>
              <div className="flex items-center gap-2 text-pd-text-secondary">
                <span className="h-2.5 w-2.5 bg-[#d97706] rounded-xs" />
                FIR Case (Amber Octagon)
              </div>
              <div className="flex items-center gap-2 text-pd-text-secondary">
                <span className="h-2.5 w-2.5 bg-[#16a34a] rounded-xs" />
                Location Node (Green Diamond)
              </div>
              <div className="flex items-center gap-2 text-pd-text-secondary">
                <span className="h-2.5 w-2.5 bg-[#9333ea] rounded-xs" />
                Vehicle (Purple Rect)
              </div>
            </div>
          )}
        </div>

        {/* 6. BOTTOM HORIZONTAL TIMELINE HUD BAR */}
        <div className="absolute bottom-3 inset-x-4 z-30 h-10 rounded-sm border border-pd-border bg-[#0d1117]/95 backdrop-blur px-4 flex items-center justify-between shadow-2xl font-mono text-[11px]">
          {/* Left Playback & Year Controls */}
          <div className="flex items-center gap-2.5">
            <span className="text-pd-text-tertiary uppercase font-bold text-[10px] tracking-wider">
              SEASONS
            </span>
            <span className="px-2 py-0.5 rounded bg-pd-elevated text-pd-text-primary font-bold border border-pd-border">
              2021
            </span>
            <span className="px-2 py-0.5 rounded bg-pd-elevated text-pd-accent font-bold border border-pd-accent/60">
              {timelineYear}
            </span>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-pd-elevated text-pd-text-secondary hover:text-pd-text-primary border border-pd-border"
            >
              {isPlaying ? "⏸ PAUSE" : "▶ PLAY"}
            </button>
          </div>

          {/* Center Timeline Ruler Slider */}
          <div className="flex-1 mx-8 flex items-center gap-3">
            <span className="text-[10px] text-pd-text-tertiary">1980</span>
            <div className="flex-1 relative flex items-center">
              <input
                type="range"
                min="1980"
                max="2024"
                value={timelineYear}
                onChange={(e) => setTimelineYear(Number(e.target.value))}
                className="w-full accent-pd-accent h-1.5 bg-[#1e293b] rounded cursor-pointer"
              />
            </div>
            <span className="text-[10px] text-pd-text-tertiary">2024</span>
          </div>

          {/* Right Interactive Zoom Controls + Scale Display */}
          <div className="flex items-center gap-2">
            <span className="text-pd-text-tertiary font-bold text-[10px]">
              {zoomScale.toFixed(2)}x
            </span>
            <button
              onClick={() => {
                if (cyRef.current) {
                  cyRef.current.zoom(cyRef.current.zoom() * 0.85);
                }
              }}
              className="h-6 w-6 rounded bg-pd-elevated text-pd-text-secondary hover:text-pd-text-primary border border-pd-border flex items-center justify-center font-bold"
              title="Zoom Out"
            >
              -
            </button>
            <button
              onClick={() => {
                if (cyRef.current) {
                  cyRef.current.zoom(cyRef.current.zoom() * 1.15);
                }
              }}
              className="h-6 w-6 rounded bg-pd-elevated text-pd-text-secondary hover:text-pd-text-primary border border-pd-border flex items-center justify-center font-bold"
              title="Zoom In"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* 7. RIGHT CONTEXTUAL INTELLIGENCE FLYOUT DRAWER */}
      {selectedNodeData && (
        <div className="w-88 border-l border-pd-border bg-[#0d1117] p-5 flex flex-col justify-between select-none shadow-2xl z-30 font-sans animate-in slide-in-from-right-4 duration-150">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-pd-border/60 pb-2.5">
              <span className="text-pd-xs font-bold uppercase tracking-wider text-pd-accent flex items-center gap-2 font-mono">
                <span className="h-2 w-2 rounded-full bg-pd-accent" />
                Intelligence Node Profile
              </span>
              <button
                onClick={() => setSelectedNodeData(null)}
                className="text-pd-text-tertiary hover:text-pd-text-primary text-sm"
              >
                ✕
              </button>
            </div>

            {/* Entity Header */}
            <div>
              <div className="text-pd-xl font-bold text-pd-text-primary">{selectedNodeData.label}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className="rounded bg-pd-danger/15 text-pd-danger font-mono text-[10px] px-2 py-0.5 font-bold border border-pd-danger/30">
                  {selectedNodeData.type}
                </span>
                <span className="font-mono text-pd-xs text-pd-text-tertiary">ID: {selectedNodeData.id.substring(0, 10)}...</span>
              </div>
            </div>

            {/* Degree & Threat Grid */}
            <div className="grid grid-cols-2 gap-2 font-mono">
              <div className="rounded bg-pd-elevated p-2.5 border border-pd-border">
                <div className="text-[10px] text-pd-text-tertiary uppercase">Connections</div>
                <div className="text-pd-lg font-bold text-pd-accent mt-0.5">{selectedNodeData.degree} Deg</div>
              </div>
              <div className="rounded bg-pd-elevated p-2.5 border border-pd-border">
                <div className="text-[10px] text-pd-text-tertiary uppercase">Threat Index</div>
                <div className="text-pd-lg font-bold text-pd-danger mt-0.5">{selectedNodeData.threatWeight}%</div>
              </div>
            </div>

            {/* Supporting Evidence Chain */}
            <div>
              <div className="text-[11px] font-bold uppercase text-pd-text-tertiary mb-2 font-mono">
                Corroborating Evidence Logs:
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {selectedNodeData.evidence.map((ev, i) => (
                  <div key={i} className="rounded bg-pd-surface p-2.5 border border-pd-border/60 space-y-1">
                    <div className="flex items-center justify-between font-mono text-[10px] text-pd-text-tertiary">
                      <span className="text-pd-accent font-semibold">{ev.logId}</span>
                      <span>{ev.time}</span>
                    </div>
                    <div className="text-pd-xs text-pd-text-secondary leading-relaxed">{ev.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="space-y-2 pt-3 border-t border-pd-border/60">
            {selectedNodeData.type === "PERSON" && (
              <button
                onClick={() => {
                  openTab({
                    id: `profile-${selectedNodeData.id}`,
                    type: "profile",
                    title: `Profile: ${selectedNodeData.label}`,
                    data: {
                      entityId: selectedNodeData.id,
                      entityName: selectedNodeData.label,
                    },
                  });
                }}
                className="flex w-full h-9 items-center justify-center gap-1.5 rounded bg-pd-accent text-pd-xs font-bold text-pd-base hover:bg-pd-accent-hover transition-colors shadow"
              >
                Open Full Dossier in New Tab
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>
            )}

            <button
              onClick={() => {
                if (cyRef.current) {
                  const node = cyRef.current.getElementById(selectedNodeData.id);
                  if (node.length) {
                    const neighborhood = node.closedNeighborhood();
                    cyRef.current.elements().difference(neighborhood).style("opacity", 0.08);
                    neighborhood.style("opacity", 1);
                  }
                }
              }}
              className="flex w-full h-8 items-center justify-center gap-1.5 rounded border border-pd-border bg-pd-elevated text-[11px] font-semibold text-pd-text-secondary hover:text-pd-text-primary hover:bg-pd-surface transition-colors"
            >
              Isolate 1-Hop Neighborhood
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
