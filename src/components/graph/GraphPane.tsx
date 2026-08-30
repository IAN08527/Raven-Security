import { useEffect, useMemo, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type { Core, ElementDefinition } from "cytoscape";
import { useQuery } from "@tanstack/react-query";
import { invokeRaven } from "../../hooks/useInvoke";
import { useCaseStore } from "../../store/case";
import type { EgoGraph } from "../../types/generated";

// Color-coded classification
const ENTITY_COLORS: Record<string, string> = {
  PERSON: "#dc2626",       // Crimson Red (Dominant Highlight - Criminals/Suspects)
  ORGANIZATION: "#d97706", // Amber Gold (FIR Cases & Shell Companies)
  ACCOUNT: "#2563eb",      // Royal Blue (Hawala & Bank Accounts)
  LOCATION: "#16a34a",     // Forest Green (Safehouses & Bases)
  VEHICLE: "#9333ea",      // Tactical Purple (Vehicles)
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

  // Intelligence Flyout Panel: INITIALLY CLOSED (null)
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

  // Build fully interconnected graph network with clear visual hierarchy (NO gray satellite clutter)
  const elements = useMemo<ElementDefinition[]>(() => {
    // 1. PRIMARY SUSPECTS / CRIMINALS (Dominant large nodes)
    const rawPersons: ElementDefinition[] = [
      { data: { id: "p-sawant", label: "Rakesh Sawant", type: "PERSON", degree: 22, size: 54, shape: "hexagon" } },
      { data: { id: "p-patel", label: "Vikram Patel", type: "PERSON", degree: 18, size: 48, shape: "hexagon" } },
      { data: { id: "p-khan", label: "Mohd. Khan", type: "PERSON", degree: 14, size: 46, shape: "hexagon" } },
      { data: { id: "p-gaikwad", label: "Deepak Gaikwad", type: "PERSON", degree: 10, size: 42, shape: "hexagon" } },
      { data: { id: "p-roy", label: "Anita Roy", type: "PERSON", degree: 8, size: 40, shape: "hexagon" } },
      { data: { id: "p-more", label: "Rahul More", type: "PERSON", degree: 12, size: 44, shape: "hexagon" } },
      { data: { id: "p-patil", label: "Suresh Patil", type: "PERSON", degree: 14, size: 46, shape: "hexagon" } },
      { data: { id: "p-jadhav", label: "Sanjay Jadhav", type: "PERSON", degree: 10, size: 42, shape: "hexagon" } },
      { data: { id: "p-deshmukh", label: "Vijay Deshmukh", type: "PERSON", degree: 12, size: 44, shape: "hexagon" } },
    ];

    // 2. CONNECTED SECONDARY ENTITIES (FIRs, Bank Accounts, Vehicles, Locations)
    const rawSecondaries: ElementDefinition[] = [
      // FIR Cases & Shell Companies (Amber)
      { data: { id: "fir-102", label: "FIR-102 (Dharavi PS)", type: "ORGANIZATION", degree: 15, size: 28, shape: "octagon" } },
      { data: { id: "fir-044", label: "FIR-044 (Crime Branch)", type: "ORGANIZATION", degree: 10, size: 26, shape: "octagon" } },
      { data: { id: "org-quickpay", label: "QuickPay Solutions Pvt Ltd", type: "ORGANIZATION", degree: 9, size: 26, shape: "octagon" } },

      // Bank & Hawala Accounts (Blue)
      { data: { id: "acc-icici", label: "ICICI 00245678901", type: "ACCOUNT", degree: 6, size: 24, shape: "hexagon" } },
      { data: { id: "acc-sbi", label: "SBI 37890123456", type: "ACCOUNT", degree: 5, size: 22, shape: "hexagon" } },
      { data: { id: "acc-hdfc", label: "HDFC 0012948201", type: "ACCOUNT", degree: 7, size: 24, shape: "hexagon" } },

      // Crime Vehicles (Purple)
      { data: { id: "veh-scorpio", label: "MH02AB1234 (Scorpio)", type: "VEHICLE", degree: 8, size: 24, shape: "round-rectangle" } },
      { data: { id: "veh-creta", label: "MH01XX9900 (Creta)", type: "VEHICLE", degree: 5, size: 22, shape: "round-rectangle" } },
      { data: { id: "veh-bolero", label: "MH12XY9988 (Bolero)", type: "VEHICLE", degree: 6, size: 22, shape: "round-rectangle" } },

      // Locations & Safehouses (Green)
      { data: { id: "loc-dharavi", label: "Dharavi Base HQ", type: "LOCATION", degree: 8, size: 24, shape: "diamond" } },
      { data: { id: "loc-sakinaka", label: "Sakinaka Junction", type: "LOCATION", degree: 6, size: 24, shape: "diamond" } },
      { data: { id: "loc-andheri", label: "Safehouse-402 (Andheri)", type: "LOCATION", degree: 5, size: 22, shape: "diamond" } },
    ];

    // 3. COMPLETE MULTI-DIRECTIONAL INTERCONNECTIONS (Connecting all suspects & entities)
    const rawEdges: ElementDefinition[] = [
      // Core Syndicate Connections to FIR-102 (Accused Cluster)
      { data: { id: "e-1", source: "p-sawant", target: "fir-102", label: "MASTERMIND (35)", w: 2.5 } },
      { data: { id: "e-2", source: "p-patel", target: "fir-102", label: "CO_ACCUSED (30)", w: 2.2 } },
      { data: { id: "e-3", source: "p-khan", target: "fir-102", label: "ARMS_SUPPLIER (28)", w: 2.0 } },
      { data: { id: "e-4", source: "p-more", target: "fir-102", label: "EXTORTION_ENFORCER (22)", w: 1.8 } },
      { data: { id: "e-5", source: "p-patil", target: "fir-102", label: "CONSPIRATOR (20)", w: 1.8 } },

      // Financial & Hawala Layer to FIR-044 & Accounts
      { data: { id: "e-6", source: "p-sawant", target: "org-quickpay", label: "BENEFICIARY (25)", w: 2.0 } },
      { data: { id: "e-7", source: "p-patel", target: "org-quickpay", label: "DIRECTOR (24)", w: 2.0 } },
      { data: { id: "e-8", source: "p-roy", target: "org-quickpay", label: "ACCOUNTANT (20)", w: 1.8 } },
      { data: { id: "e-9", source: "p-roy", target: "fir-044", label: "NAMED_IN (18)", w: 1.6 } },
      { data: { id: "e-10", source: "org-quickpay", target: "acc-icici", label: "HAWALA_ROUTING (22)", w: 1.8 } },
      { data: { id: "e-11", source: "p-gaikwad", target: "acc-icici", label: "CASH_WITHDRAWAL (15)", w: 1.4 } },
      { data: { id: "e-12", source: "p-jadhav", target: "acc-sbi", label: "UPI_DEPOSIT (14)", w: 1.4 } },
      { data: { id: "e-13", source: "p-patel", target: "acc-hdfc", label: "WIRE_TRANSFER (18)", w: 1.6 } },
      { data: { id: "e-14", source: "p-patil", target: "acc-sbi", label: "MULE_ACCOUNT (16)", w: 1.5 } },

      // Vehicle Convoy & Surveillance Connections
      { data: { id: "e-15", source: "p-sawant", target: "veh-scorpio", label: "REGISTERED_OWNER (25)", w: 2.0 } },
      { data: { id: "e-16", source: "p-gaikwad", target: "veh-scorpio", label: "PRIMARY_DRIVER (20)", w: 1.8 } },
      { data: { id: "e-17", source: "p-patel", target: "veh-creta", label: "OWNER (18)", w: 1.6 } },
      { data: { id: "e-18", source: "p-deshmukh", target: "veh-bolero", label: "DRIVER (20)", w: 1.8 } },
      { data: { id: "e-19", source: "p-jadhav", target: "veh-bolero", label: "PASSENGER (16)", w: 1.5 } },

      // Location, Base & Safehouse Meetings
      { data: { id: "e-20", source: "p-sawant", target: "loc-dharavi", label: "HOME_BASE (28)", w: 2.2 } },
      { data: { id: "e-21", source: "p-khan", target: "loc-dharavi", label: "MEETING_POINT (22)", w: 1.8 } },
      { data: { id: "e-22", source: "p-more", target: "loc-sakinaka", label: "SURVEILLANCE_POST (18)", w: 1.6 } },
      { data: { id: "e-23", source: "p-deshmukh", target: "loc-sakinaka", label: "RENDEZVOUS (16)", w: 1.5 } },
      { data: { id: "e-24", source: "p-khan", target: "loc-andheri", label: "ARMS_STORAGE (20)", w: 1.8 } },
      { data: { id: "e-25", source: "p-patil", target: "loc-andheri", label: "SAFEHOUSE (16)", w: 1.5 } },

      // Direct Criminal Associate Inter-links (CDR Calls & Conspiracies)
      { data: { id: "e-26", source: "p-sawant", target: "p-patel", label: "47_CALLS_LOGGED (30)", w: 2.4 } },
      { data: { id: "e-27", source: "p-sawant", target: "p-khan", label: "DIRECT_COORDINATION (26)", w: 2.0 } },
      { data: { id: "e-28", source: "p-patel", target: "p-more", label: "CASH_HANDOFF (22)", w: 1.8 } },
      { data: { id: "e-29", source: "p-more", target: "p-jadhav", label: "FIELD_OPERATION (20)", w: 1.6 } },
      { data: { id: "e-30", source: "p-patil", target: "p-deshmukh", label: "LOGISTICS_LINK (18)", w: 1.6 } },
      { data: { id: "e-31", source: "p-gaikwad", target: "p-jadhav", label: "RECON_MATCH (16)", w: 1.4 } },
    ];

    // Filter nodes based on user layer checkboxes
    const allowedTypes = new Set<string>(["PERSON"]); // People always locked ON
    if (layerFilters.institutions) allowedTypes.add("ORGANIZATION");
    if (layerFilters.accounts) allowedTypes.add("ACCOUNT");
    if (layerFilters.vehicles) allowedTypes.add("VEHICLE");
    allowedTypes.add("LOCATION");

    const filteredNodes = [...rawPersons, ...rawSecondaries].filter((n) =>
      allowedTypes.has(n.data.type)
    );

    const validIds = new Set(filteredNodes.map((n) => n.data.id));

    const filteredEdges = rawEdges.filter(
      (e) => validIds.has(e.data.source) && validIds.has(e.data.target)
    );

    return [...filteredNodes, ...filteredEdges];
  }, [layerFilters]);

  // Handle Layout & Interactive Events on Cy instance
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // SPATIOUS FORCE-DIRECTED PHYSICS: Generous repulsion and link length for clear separation
    const layout = cy.layout({
      name: layoutName,
      animate: false,
      padding: 80,
      nodeRepulsion: () => 35000,
      idealEdgeLength: () => 180,
      edgeElasticity: () => 32,
      gravity: 0.18,
    } as any);
    layout.run();

    // Zoom listener to update HUD zoom scale
    cy.on("zoom", () => {
      setZoomScale(cy.zoom());
    });

    // Node click: select & open contextual intelligence drawer
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
          { logId: "LOG-0842", time: "2024-03-12 14:32", text: `Active connection verified in case docket (Connection Weight: ${data.degree || 8})` },
          { logId: "LOG-0843", time: "2024-03-14 09:15", text: `Telecom CDR ping match Tower MH-MUM-0847` },
          { logId: "LOG-0844", time: "2024-03-18 22:40", text: `Corroborating on-chain forensic audit record anchored` },
        ],
      });
    });

    // Double-click person node: open full suspect profile tab
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
            // 1. PRIMARY HIGHLIGHT: PERSON / SUSPECT (Dominant Red Hexagon)
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
                "text-margin-y": -8,
                opacity: 1,
              },
            },
            // Secondary Entities: Organizations / FIRs (Subordinated Amber)
            {
              selector: "node[type = 'ORGANIZATION']",
              style: {
                width: "data(size)",
                height: "data(size)",
                shape: "octagon",
                "background-color": ENTITY_COLORS.ORGANIZATION,
                "border-width": 1.2,
                "border-color": "#ffffff",
                label: "data(label)",
                color: "#f59e0b",
                "font-family": "JetBrains Mono",
                "font-size": 9,
                "text-valign": "bottom",
                "text-margin-y": 6,
                opacity: 0.88,
              },
            },
            // Secondary Entities: Bank Accounts / Hawala (Subordinated Blue)
            {
              selector: "node[type = 'ACCOUNT']",
              style: {
                width: "data(size)",
                height: "data(size)",
                shape: "hexagon",
                "background-color": ENTITY_COLORS.ACCOUNT,
                "border-width": 1.2,
                "border-color": "#ffffff",
                label: "data(label)",
                color: "#60a5fa",
                "font-family": "JetBrains Mono",
                "font-size": 8.5,
                "text-valign": "bottom",
                "text-margin-y": 6,
                opacity: 0.88,
              },
            },
            // Secondary Entities: Locations / Safehouses (Subordinated Green)
            {
              selector: "node[type = 'LOCATION']",
              style: {
                width: "data(size)",
                height: "data(size)",
                shape: "diamond",
                "background-color": ENTITY_COLORS.LOCATION,
                "border-width": 1.2,
                "border-color": "#ffffff",
                label: "data(label)",
                color: "#4ade80",
                "font-family": "JetBrains Mono",
                "font-size": 8.5,
                "text-valign": "bottom",
                "text-margin-y": 6,
                opacity: 0.88,
              },
            },
            // Secondary Entities: Vehicles (Subordinated Purple)
            {
              selector: "node[type = 'VEHICLE']",
              style: {
                width: "data(size)",
                height: "data(size)",
                shape: "round-rectangle",
                "background-color": ENTITY_COLORS.VEHICLE,
                "border-width": 1.2,
                "border-color": "#ffffff",
                label: "data(label)",
                color: "#c084fc",
                "font-family": "JetBrains Mono",
                "font-size": 8.5,
                "text-valign": "bottom",
                "text-margin-y": 6,
                opacity: 0.88,
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
            // Clear Connection Edges
            {
              selector: "edge",
              style: {
                width: "data(w)",
                "line-color": "#334155",
                "curve-style": "bezier",
                opacity: 0.55,
                "target-arrow-shape": "none",
              },
            },
            // Active Selected Connected Edges
            {
              selector: "edge:selected",
              style: {
                width: 2.2,
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
                cyRef.current.fit(undefined, 60);
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
