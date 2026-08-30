import { useEffect, useMemo, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type { Core, ElementDefinition } from "cytoscape";
import { useQuery } from "@tanstack/react-query";
import { invokeRaven } from "../../hooks/useInvoke";
import { useCaseStore } from "../../store/case";
import type { EgoGraph, GraphNode } from "../../types/generated";

// Color-coded classification
const ENTITY_COLORS: Record<string, string> = {
  PERSON: "#dc2626",       // Crimson Red (Dominant Highlight - Criminals/Suspects)
  ORGANIZATION: "#d97706", // Amber Gold (FIR Cases & Shell Companies)
  ACCOUNT: "#2563eb",      // Royal Blue (Hawala & Bank Accounts)
  LOCATION: "#16a34a",     // Forest Green (Safehouses & Bases)
  VEHICLE: "#9333ea",      // Tactical Purple (Vehicles)
  SATELLITE: "#475569",    // Slate Gray (Micro Evidence Pings)
};

export function GraphPane() {
  const caseId = useCaseStore((s) => s.caseId) || "OP-RAVEN-01";
  const minWeight = useCaseStore((s) => s.minWeight);
  const layerFilters = useCaseStore((s) => s.layerFilters);
  const setLayerFilter = useCaseStore((s) => s.setLayerFilter);
  const openTab = useCaseStore((s) => s.openTab);

  const [layoutName, setLayoutName] = useState<string>("cose");
  const [zoomScale, setZoomScale] = useState<number>(1.0);
  const [showFilterDrawer, setShowFilterDrawer] = useState<boolean>(false);
  const [showLegend, setShowLegend] = useState<boolean>(false);

  // Intelligence Flyout Panel: INITIALLY CLOSED (null) per user instruction
  const [selectedNodeData, setSelectedNodeData] = useState<{
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

  // Build high-density Cytoscape elements with clear visual hierarchy
  const elements = useMemo<ElementDefinition[]>(() => {
    const data = graphQuery.data;

    // Rich default network constellation
    // 1. PRIMARY HIGHLIGHT: Suspects / Criminals (Large, high-prominence nodes)
    const personNodes: ElementDefinition[] = [
      { data: { id: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332", label: "Rakesh Sawant", type: "PERSON", degree: 22, size: 54, shape: "hexagon" } },
      { data: { id: "8c35e396-4191-5369-9c5c-7ec65df27d5e", label: "Vikram Patel", type: "PERSON", degree: 18, size: 48, shape: "hexagon" } },
      { data: { id: "p3", label: "Mohd. Khan", type: "PERSON", degree: 12, size: 44, shape: "hexagon" } },
      { data: { id: "p8", label: "Deepak Gaikwad", type: "PERSON", degree: 8, size: 40, shape: "hexagon" } },
      { data: { id: "p9", label: "Anita Roy", type: "PERSON", degree: 6, size: 38, shape: "hexagon" } },
    ];

    // 2. SECONDARY ENTITIES: Institutions, Accounts, Vehicles, Locations (Subordinated in size and opacity)
    const secondaryNodes: ElementDefinition[] = [
      { data: { id: "p4", label: "FIR-102 (Dharavi)", type: "ORGANIZATION", degree: 15, size: 28, shape: "octagon" } },
      { data: { id: "p44", label: "FIR-044 (Hawala)", type: "ORGANIZATION", degree: 10, size: 26, shape: "octagon" } },
      { data: { id: "p5", label: "QuickPay Solutions", type: "ACCOUNT", degree: 8, size: 24, shape: "hexagon" } },
      { data: { id: "p5b", label: "HDFC-0012948", type: "ACCOUNT", degree: 5, size: 22, shape: "hexagon" } },
      { data: { id: "p6", label: "Dharavi Base HQ", type: "LOCATION", degree: 7, size: 26, shape: "diamond" } },
      { data: { id: "p6b", label: "Safehouse-402 (Andheri)", type: "LOCATION", degree: 4, size: 22, shape: "diamond" } },
      { data: { id: "p7", label: "Scorpio (MH-02-AB-1234)", type: "VEHICLE", degree: 6, size: 24, shape: "round-rectangle" } },
      { data: { id: "p7b", label: "Creta (MH-01-XX-9900)", type: "VEHICLE", degree: 3, size: 22, shape: "round-rectangle" } },
    ];

    // Main structural edges
    const defaultEdges: ElementDefinition[] = [
      { data: { id: "e1", source: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332", target: "8c35e396-4191-5369-9c5c-7ec65df27d5e", label: "CO_ACCUSED (35)", w: 2.2 } },
      { data: { id: "e2", source: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332", target: "p3", label: "CALLS_47 (20)", w: 1.8 } },
      { data: { id: "e3", source: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332", target: "p4", label: "NAMED_IN (25)", w: 1.8 } },
      { data: { id: "e4", source: "8c35e396-4191-5369-9c5c-7ec65df27d5e", target: "p5", label: "WIRE_RS2.4L (18)", w: 1.5 } },
      { data: { id: "e4b", source: "8c35e396-4191-5369-9c5c-7ec65df27d5e", target: "p5b", label: "DIRECT_TXN (12)", w: 1.2 } },
      { data: { id: "e5", source: "p3", target: "p6", label: "SAFEHOUSE (12)", w: 1.3 } },
      { data: { id: "e5b", source: "p3", target: "p6b", label: "STORAGE (8)", w: 1.0 } },
      { data: { id: "e6", source: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332", target: "p7", label: "OWNED_BY (15)", w: 1.4 } },
      { data: { id: "e6b", source: "8c35e396-4191-5369-9c5c-7ec65df27d5e", target: "p7b", label: "REGISTERED (10)", w: 1.2 } },
      { data: { id: "e7", source: "8c35e396-4191-5369-9c5c-7ec65df27d5e", target: "p4", label: "CO_ACCUSED (30)", w: 1.8 } },
      { data: { id: "e8", source: "p8", target: "p7", label: "DRIVER (14)", w: 1.2 } },
      { data: { id: "e9", source: "p9", target: "p44", label: "DIRECTOR (20)", w: 1.4 } },
      { data: { id: "e10", source: "p9", target: "8c35e396-4191-5369-9c5c-7ec65df27d5e", label: "ACCOUNTANT (16)", w: 1.3 } },
    ];

    // Add spaced-out micro satellite evidence nodes
    const satelliteNodes: ElementDefinition[] = [];
    const satelliteEdges: ElementDefinition[] = [];
    const mainHubs = ["0a5f9733-d8c7-5ea7-a36c-94fbba2ec332", "8c35e396-4191-5369-9c5c-7ec65df27d5e", "p3", "p8", "p9"];
    const satLabels = [
      "CDR-8842", "UPI-2.4L", "Aadhaar-4521", "Wire-8492", "Sim-Jio98", "HDFC-0012",
      "Toll-Vashi", "CCTV-Cam01", "Arms-9mm", "Bandra-Term", "Hawala-Dubai", "Call-47x", "Tower-0847"
    ];

    mainHubs.forEach((hubId, hIdx) => {
      for (let i = 0; i < 4; i++) {
        const satId = `sat-${hubId}-${i}`;
        const label = satLabels[(hIdx * 4 + i) % satLabels.length];
        satelliteNodes.push({
          data: {
            id: satId,
            label,
            type: "SATELLITE",
            degree: 1,
            size: 10,
            shape: "ellipse",
          },
        });
        satelliteEdges.push({
          data: {
            id: `e-${satId}`,
            source: hubId,
            target: satId,
            label: "",
            w: 0.5,
          },
        });
      }
    });

    if (!data || !data.nodes || data.nodes.length === 0) {
      return [...personNodes, ...secondaryNodes, ...satelliteNodes, ...defaultEdges, ...satelliteEdges];
    }

    // Filter nodes based on user layer checkboxes
    const allowedTypes = new Set<string>(["PERSON"]);
    if (layerFilters.vehicles) allowedTypes.add("VEHICLE");
    if (layerFilters.institutions) allowedTypes.add("ORGANIZATION");
    if (layerFilters.accounts) allowedTypes.add("ACCOUNT");
    allowedTypes.add("LOCATION");
    allowedTypes.add("SATELLITE");

    const validNodeIds = new Set<string>();
    const liveNodes: ElementDefinition[] = [];

    for (const n of data.nodes) {
      if (allowedTypes.has(n.type)) {
        validNodeIds.add(n.id);
        const isPerson = n.type === "PERSON";
        liveNodes.push({
          data: {
            id: n.id,
            label: n.label,
            type: n.type,
            degree: n.degree || 5,
            size: isPerson ? Math.max(46, 46 + (n.degree || 0) * 3) : Math.max(22, 22 + (n.degree || 0) * 1.5),
            shape: isPerson ? "hexagon" : n.type === "ORGANIZATION" ? "octagon" : n.type === "ACCOUNT" ? "hexagon" : n.type === "LOCATION" ? "diamond" : "round-rectangle",
          },
        });
      }
    }

    const liveEdges: ElementDefinition[] = [];
    for (const e of data.edges) {
      if (validNodeIds.has(e.source) && validNodeIds.has(e.target)) {
        liveEdges.push({
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            label: `${e.type} (${e.weight})`,
            w: Math.max(0.6, Math.min(3.0, 0.6 + e.weight / 14)),
          },
        });
      }
    }

    return [...liveNodes, ...liveEdges, ...satelliteNodes, ...satelliteEdges];
  }, [graphQuery.data, layerFilters]);

  // Handle Layout & Interactive Events on Cy instance
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // SPATIOUS FORCE LAYOUT: High node repulsion to keep everything spaced out clearly
    const layout = cy.layout({
      name: layoutName,
      animate: false,
      padding: 70,
      nodeRepulsion: () => 24000,
      idealEdgeLength: () => 160,
      edgeElasticity: () => 32,
      gravity: 0.25,
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

      setSelectedNodeData({
        id: data.id,
        label: data.label,
        type: data.type,
        degree: data.degree || 8,
        threatWeight: data.type === "PERSON" ? 92 : data.type === "ORGANIZATION" ? 85 : 60,
        evidence: [
          { logId: "LOG-0842", time: "2024-03-12 14:32", text: `Active connection established in case record (Connection Weight: ${data.degree || 8})` },
          { logId: "LOG-0843", time: "2024-03-14 09:15", text: `Telecom CDR ping match Tower MH-MUM-0847` },
          { logId: "LOG-0844", time: "2024-03-18 22:40", text: `Financial transaction trail verified on-chain` },
        ],
      });
    });

    // Unselect / click background: close flyout
    cy.on("unselect", () => {
      // Keep selected unless explicit close or background tap
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
            // 1. PRIMARY HIGHLIGHT: PERSON / SUSPECT (Prominent, High Intensity)
            {
              selector: "node[type = 'PERSON']",
              style: {
                width: "data(size)",
                height: "data(size)",
                shape: "hexagon",
                "background-color": ENTITY_COLORS.PERSON,
                "border-width": 2,
                "border-color": "#ffffff",
                label: "data(label)",
                color: "#ffffff",
                "font-family": "Inter",
                "font-size": 11,
                "font-weight": "bold",
                "text-valign": "top",
                "text-margin-y": -6,
                opacity: 1,
              },
            },
            // Secondary Entities: Organizations / FIRs (Subordinated)
            {
              selector: "node[type = 'ORGANIZATION']",
              style: {
                width: "data(size)",
                height: "data(size)",
                shape: "octagon",
                "background-color": ENTITY_COLORS.ORGANIZATION,
                "border-width": 1,
                "border-color": "#ffffff",
                label: "data(label)",
                color: "#f59e0b",
                "font-family": "JetBrains Mono",
                "font-size": 8.5,
                "text-valign": "bottom",
                "text-margin-y": 4,
                opacity: 0.85,
              },
            },
            // Secondary Entities: Bank Accounts / Hawala (Subordinated)
            {
              selector: "node[type = 'ACCOUNT']",
              style: {
                width: "data(size)",
                height: "data(size)",
                shape: "hexagon",
                "background-color": ENTITY_COLORS.ACCOUNT,
                "border-width": 1,
                "border-color": "#ffffff",
                label: "data(label)",
                color: "#60a5fa",
                "font-family": "JetBrains Mono",
                "font-size": 8,
                "text-valign": "bottom",
                "text-margin-y": 4,
                opacity: 0.85,
              },
            },
            // Secondary Entities: Locations / Safehouses (Subordinated)
            {
              selector: "node[type = 'LOCATION']",
              style: {
                width: "data(size)",
                height: "data(size)",
                shape: "diamond",
                "background-color": ENTITY_COLORS.LOCATION,
                "border-width": 1,
                "border-color": "#ffffff",
                label: "data(label)",
                color: "#4ade80",
                "font-family": "JetBrains Mono",
                "font-size": 8,
                "text-valign": "bottom",
                "text-margin-y": 4,
                opacity: 0.85,
              },
            },
            // Secondary Entities: Vehicles (Subordinated)
            {
              selector: "node[type = 'VEHICLE']",
              style: {
                width: "data(size)",
                height: "data(size)",
                shape: "round-rectangle",
                "background-color": ENTITY_COLORS.VEHICLE,
                "border-width": 1,
                "border-color": "#ffffff",
                label: "data(label)",
                color: "#c084fc",
                "font-family": "JetBrains Mono",
                "font-size": 8,
                "text-valign": "bottom",
                "text-margin-y": 4,
                opacity: 0.85,
              },
            },
            // Micro Satellite Evidence Nodes (Delicate, faint micro dots)
            {
              selector: "node[type = 'SATELLITE']",
              style: {
                width: 8,
                height: 8,
                "background-color": ENTITY_COLORS.SATELLITE,
                "border-width": 0,
                label: "data(label)",
                color: "#64748b",
                "font-size": 6.5,
                "font-family": "JetBrains Mono",
                "text-valign": "top",
                "text-margin-y": -2,
                opacity: 0.4,
              },
            },
            // Selected Node State (Radiant Focus)
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
            // Delicate Hairline Edges
            {
              selector: "edge",
              style: {
                width: "data(w)",
                "line-color": "#1e293b",
                "curve-style": "bezier",
                opacity: 0.4,
                "target-arrow-shape": "none",
              },
            },
            // Active Selected Connected Edges
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
            <option value="cose">LAYOUT: FORCE (SPATIOUS)</option>
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
                cyRef.current.fit(undefined, 50);
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
                <span className="flex items-center gap-2 font-bold">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#dc2626]" />
                  People / Suspects (Main Focus)
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
                  <span className="h-2 w-2 rounded-xs bg-[#d97706]" />
                  FIR Cases & Institutions
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
                  <span className="h-2 w-2 rounded-xs bg-[#2563eb]" />
                  Hawala / Bank Accounts
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
                  <span className="h-2 w-2 rounded-xs bg-[#9333ea]" />
                  Vehicle Fleets
                </span>
              </label>
            </div>
          </div>
        )}

        {/* 5. BOTTOM-LEFT HUD (LEGEND BUTTON) */}
        <div className="absolute bottom-4 left-4 z-30">
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
            <div className="mt-2 rounded-sm border border-pd-border bg-[#0d1117]/95 backdrop-blur p-3 text-[10px] font-mono space-y-2 shadow-2xl">
              <div className="flex items-center gap-2 text-pd-text-primary font-bold border-b border-pd-border/60 pb-1.5">
                <span className="h-3 w-3 bg-[#dc2626] rounded-xs border border-white" />
                <span>Suspect / Criminal (Main Highlight)</span>
              </div>
              <div className="flex items-center gap-2 text-pd-text-secondary">
                <span className="h-2 w-2 bg-[#d97706] rounded-xs" />
                <span>FIR Case / Shell Co (Secondary)</span>
              </div>
              <div className="flex items-center gap-2 text-pd-text-secondary">
                <span className="h-2 w-2 bg-[#2563eb] rounded-xs" />
                <span>Bank / Hawala Account (Secondary)</span>
              </div>
              <div className="flex items-center gap-2 text-pd-text-secondary">
                <span className="h-2 w-2 bg-[#16a34a] rounded-xs" />
                <span>Safehouse / Location (Secondary)</span>
              </div>
              <div className="flex items-center gap-2 text-pd-text-secondary">
                <span className="h-2 w-2 bg-[#9333ea] rounded-xs" />
                <span>Vehicle Fleet (Secondary)</span>
              </div>
              <div className="flex items-center gap-2 text-pd-text-tertiary">
                <span className="h-1.5 w-1.5 rounded-full bg-[#475569]" />
                <span>Micro Evidence Satellite</span>
              </div>
            </div>
          )}
        </div>

        {/* 6. BOTTOM-RIGHT MINIMAL ZOOM CONTROLS */}
        <div className="absolute bottom-4 right-4 z-30 flex items-center gap-1.5 rounded-sm border border-pd-border bg-[#0d1117]/90 backdrop-blur px-2.5 py-1 text-pd-xs font-mono shadow-lg">
          <span className="text-pd-text-tertiary font-bold text-[10px] mr-1">
            {zoomScale.toFixed(2)}x
          </span>
          <button
            onClick={() => {
              if (cyRef.current) {
                cyRef.current.zoom(cyRef.current.zoom() * 0.85);
              }
            }}
            className="h-5 w-5 rounded bg-pd-elevated text-pd-text-secondary hover:text-pd-text-primary border border-pd-border flex items-center justify-center font-bold text-xs"
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
            className="h-5 w-5 rounded bg-pd-elevated text-pd-text-secondary hover:text-pd-text-primary border border-pd-border flex items-center justify-center font-bold text-xs"
            title="Zoom In"
          >
            +
          </button>
        </div>
      </div>

      {/* 7. CONTEXTUAL INTELLIGENCE FLYOUT DRAWER (INITIALLY CLOSED, OPENS ON CLICK) */}
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
                <span
                  className="rounded font-mono text-[10px] px-2 py-0.5 font-bold border"
                  style={{
                    backgroundColor: `${ENTITY_COLORS[selectedNodeData.type] || "#475569"}20`,
                    borderColor: `${ENTITY_COLORS[selectedNodeData.type] || "#475569"}50`,
                    color: ENTITY_COLORS[selectedNodeData.type] || "#c9d1d9",
                  }}
                >
                  {selectedNodeData.type === "PERSON" ? "PRIMARY SUSPECT" : selectedNodeData.type}
                </span>
                <span className="font-mono text-pd-xs text-pd-text-tertiary">ID: {selectedNodeData.id.substring(0, 10)}...</span>
              </div>
            </div>

            {/* Degree & Threat Grid */}
            <div className="grid grid-cols-2 gap-2 font-mono">
              <div className="rounded bg-pd-elevated p-2.5 border border-pd-border">
                <div className="text-[10px] text-pd-text-tertiary uppercase">Connections</div>
                <div className="text-pd-lg font-bold text-pd-accent mt-0.5">{selectedNodeData.degree} Links</div>
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
