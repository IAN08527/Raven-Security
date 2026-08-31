import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type { Core, ElementDefinition } from "cytoscape";
import { useQuery } from "@tanstack/react-query";
import { invokeRaven } from "../../hooks/useInvoke";
import { useCaseStore } from "../../store/case";
import type { EgoGraph } from "../../types/generated";

// ── RAVEN-refactor theme tokens (match RavenShell) ──
const AC = "#e8c15a";
const hexA = (h: string, a: number) => h + Math.round(a * 255).toString(16).padStart(2, "0");
const acBorder = hexA(AC, 0.35);
const MONO = "'Spline Sans Mono',monospace";
const mono = (extra?: CSSProperties): CSSProperties => ({ fontFamily: MONO, ...extra });
const CANVAS_BG = "#060809";

// Entity palette — refactor theme
const ENTITY_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  PERSON: { fill: "#ff5a3c", stroke: "#ff5a3c", text: "#e8edf2" }, // suspect red
  ORGANIZATION: { fill: "#e0a63d", stroke: "#e0a63d", text: "#e0a63d" }, // FIR / shell amber
  ACCOUNT: { fill: AC, stroke: AC, text: AC }, // account yellow (accent)
  LOCATION: { fill: "#5ecf9a", stroke: "#5ecf9a", text: "#5ecf9a" }, // location green
  VEHICLE: { fill: "#b18cff", stroke: "#b18cff", text: "#b18cff" }, // vehicle purple
};

// Floating HUD control style
const hudBtn: CSSProperties = mono({
  display: "flex",
  alignItems: "center",
  gap: 7,
  height: 28,
  padding: "0 11px",
  background: "#0b0e12",
  border: "1px solid #1b212b",
  color: "#98a4b3",
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: ".12em",
  cursor: "pointer",
});

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

  // Build fully interconnected graph network with compact, elegant geometric shapes
  const elements = useMemo<ElementDefinition[]>(() => {
    // 1. PRIMARY SUSPECTS / CRIMINALS (Compact, refined Hexagons with degree badges)
    const rawPersons: ElementDefinition[] = [
      { data: { id: "p-sawant", label: "Rakesh Sawant", type: "PERSON", degree: 22, size: 30, shape: "hexagon" } },
      { data: { id: "p-patel", label: "Vikram Patel", type: "PERSON", degree: 18, size: 28, shape: "hexagon" } },
      { data: { id: "p-khan", label: "Mohd. Khan", type: "PERSON", degree: 14, size: 26, shape: "hexagon" } },
      { data: { id: "p-gaikwad", label: "Deepak Gaikwad", type: "PERSON", degree: 10, size: 24, shape: "hexagon" } },
      { data: { id: "p-roy", label: "Anita Roy", type: "PERSON", degree: 8, size: 24, shape: "hexagon" } },
      { data: { id: "p-more", label: "Rahul More", type: "PERSON", degree: 12, size: 26, shape: "hexagon" } },
      { data: { id: "p-patil", label: "Suresh Patil", type: "PERSON", degree: 14, size: 26, shape: "hexagon" } },
      { data: { id: "p-jadhav", label: "Sanjay Jadhav", type: "PERSON", degree: 10, size: 24, shape: "hexagon" } },
      { data: { id: "p-deshmukh", label: "Vijay Deshmukh", type: "PERSON", degree: 12, size: 26, shape: "hexagon" } },
    ];

    // 2. CONNECTED SECONDARY ENTITIES (FIRs, Bank Accounts, Vehicles, Locations - Compact Size)
    const rawSecondaries: ElementDefinition[] = [
      // FIR Cases & Shell Companies (Amber Octagons)
      { data: { id: "fir-102", label: "FIR-102 (Dharavi PS)", type: "ORGANIZATION", degree: 15, size: 18, shape: "octagon" } },
      { data: { id: "fir-044", label: "FIR-044 (Crime Branch)", type: "ORGANIZATION", degree: 10, size: 16, shape: "octagon" } },
      { data: { id: "org-quickpay", label: "QuickPay Solutions Pvt Ltd", type: "ORGANIZATION", degree: 9, size: 16, shape: "octagon" } },

      // Bank & Hawala Accounts (Blue Hexagons)
      { data: { id: "acc-icici", label: "ICICI 00245678901", type: "ACCOUNT", degree: 6, size: 15, shape: "hexagon" } },
      { data: { id: "acc-sbi", label: "SBI 37890123456", type: "ACCOUNT", degree: 5, size: 14, shape: "hexagon" } },
      { data: { id: "acc-hdfc", label: "HDFC 0012948201", type: "ACCOUNT", degree: 7, size: 15, shape: "hexagon" } },

      // Crime Vehicles (Purple Rounded Rectangles)
      { data: { id: "veh-scorpio", label: "MH02AB1234 (Scorpio)", type: "VEHICLE", degree: 8, size: 16, shape: "round-rectangle" } },
      { data: { id: "veh-creta", label: "MH01XX9900 (Creta)", type: "VEHICLE", degree: 5, size: 15, shape: "round-rectangle" } },
      { data: { id: "veh-bolero", label: "MH12XY9988 (Bolero)", type: "VEHICLE", degree: 6, size: 15, shape: "round-rectangle" } },

      // Locations & Safehouses (Green Diamonds)
      { data: { id: "loc-dharavi", label: "Dharavi Base HQ", type: "LOCATION", degree: 8, size: 16, shape: "diamond" } },
      { data: { id: "loc-sakinaka", label: "Sakinaka Junction", type: "LOCATION", degree: 6, size: 15, shape: "diamond" } },
      { data: { id: "loc-andheri", label: "Safehouse-402 (Andheri)", type: "LOCATION", degree: 5, size: 14, shape: "diamond" } },
    ];

    // 3. COMPLETE MULTI-DIRECTIONAL INTERCONNECTIONS
    const rawEdges: ElementDefinition[] = [
      // Core Accused Syndicate Cluster to FIR-102
      { data: { id: "e-1", source: "p-sawant", target: "fir-102", label: "MASTERMIND (35)", w: 1.8 } },
      { data: { id: "e-2", source: "p-patel", target: "fir-102", label: "CO_ACCUSED (30)", w: 1.6 } },
      { data: { id: "e-3", source: "p-khan", target: "fir-102", label: "ARMS_SUPPLIER (28)", w: 1.5 } },
      { data: { id: "e-4", source: "p-more", target: "fir-102", label: "EXTORTION_ENFORCER (22)", w: 1.3 } },
      { data: { id: "e-5", source: "p-patil", target: "fir-102", label: "CONSPIRATOR (20)", w: 1.3 } },

      // Financial & Hawala Layer to FIR-044 & Accounts
      { data: { id: "e-6", source: "p-sawant", target: "org-quickpay", label: "BENEFICIARY (25)", w: 1.5 } },
      { data: { id: "e-7", source: "p-patel", target: "org-quickpay", label: "DIRECTOR (24)", w: 1.5 } },
      { data: { id: "e-8", source: "p-roy", target: "org-quickpay", label: "ACCOUNTANT (20)", w: 1.4 } },
      { data: { id: "e-9", source: "p-roy", target: "fir-044", label: "NAMED_IN (18)", w: 1.3 } },
      { data: { id: "e-10", source: "org-quickpay", target: "acc-icici", label: "HAWALA_ROUTING (22)", w: 1.4 } },
      { data: { id: "e-11", source: "p-gaikwad", target: "acc-icici", label: "CASH_WITHDRAWAL (15)", w: 1.2 } },
      { data: { id: "e-12", source: "p-jadhav", target: "acc-sbi", label: "UPI_DEPOSIT (14)", w: 1.2 } },
      { data: { id: "e-13", source: "p-patel", target: "acc-hdfc", label: "WIRE_TRANSFER (18)", w: 1.3 } },
      { data: { id: "e-14", source: "p-patil", target: "acc-sbi", label: "MULE_ACCOUNT (16)", w: 1.2 } },

      // Vehicle Convoy & Surveillance Connections
      { data: { id: "e-15", source: "p-sawant", target: "veh-scorpio", label: "OWNER (25)", w: 1.5 } },
      { data: { id: "e-16", source: "p-gaikwad", target: "veh-scorpio", label: "DRIVER (20)", w: 1.3 } },
      { data: { id: "e-17", source: "p-patel", target: "veh-creta", label: "OWNER (18)", w: 1.3 } },
      { data: { id: "e-18", source: "p-deshmukh", target: "veh-bolero", label: "DRIVER (20)", w: 1.3 } },
      { data: { id: "e-19", source: "p-jadhav", target: "veh-bolero", label: "PASSENGER (16)", w: 1.2 } },

      // Location, Base & Safehouse Meetings
      { data: { id: "e-20", source: "p-sawant", target: "loc-dharavi", label: "HOME_BASE (28)", w: 1.6 } },
      { data: { id: "e-21", source: "p-khan", target: "loc-dharavi", label: "MEETING_POINT (22)", w: 1.4 } },
      { data: { id: "e-22", source: "p-more", target: "loc-sakinaka", label: "SURVEILLANCE (18)", w: 1.3 } },
      { data: { id: "e-23", source: "p-deshmukh", target: "loc-sakinaka", label: "RENDEZVOUS (16)", w: 1.2 } },
      { data: { id: "e-24", source: "p-khan", target: "loc-andheri", label: "ARMS_STORAGE (20)", w: 1.3 } },
      { data: { id: "e-25", source: "p-patil", target: "loc-andheri", label: "SAFEHOUSE (16)", w: 1.2 } },

      // Direct Criminal Associate Inter-links (CDR Calls & Conspiracies)
      { data: { id: "e-26", source: "p-sawant", target: "p-patel", label: "47_CALLS (30)", w: 1.8 } },
      { data: { id: "e-27", source: "p-sawant", target: "p-khan", label: "COORDINATION (26)", w: 1.6 } },
      { data: { id: "e-28", source: "p-patel", target: "p-more", label: "CASH_HANDOFF (22)", w: 1.4 } },
      { data: { id: "e-29", source: "p-more", target: "p-jadhav", label: "FIELD_OPS (20)", w: 1.3 } },
      { data: { id: "e-30", source: "p-patil", target: "p-deshmukh", label: "LOGISTICS (18)", w: 1.3 } },
      { data: { id: "e-31", source: "p-gaikwad", target: "p-jadhav", label: "RECON (16)", w: 1.2 } },
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

    // HIGH REPULSION SPATIOUS PHYSICS: Spreads nodes comfortably across the canvas
    const layout = cy.layout({
      name: layoutName,
      animate: false,
      padding: 90,
      nodeRepulsion: () => 65000,
      idealEdgeLength: () => 210,
      edgeElasticity: () => 16,
      gravity: 0.12,
      numIter: 1000,
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
          { logId: "LOG-0842", time: "2024-03-12 14:32", text: `Active link established in case record (Weight: ${data.degree || 8})` },
          { logId: "LOG-0843", time: "2024-03-14 09:15", text: `Telecom CDR ping match Tower MH-MUM-0847` },
          { logId: "LOG-0844", time: "2024-03-18 22:40", text: `Corroborating on-chain forensic audit anchored` },
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

  // Build a cytoscape node style block for one entity type
  const nodeStyle = (type: keyof typeof ENTITY_COLORS, top: boolean) => ({
    selector: `node[type = '${type}']`,
    style: {
      width: "data(size)",
      height: "data(size)",
      "background-color": ENTITY_COLORS[type].fill,
      "background-opacity": type === "PERSON" ? 0.32 : 0.2,
      "border-width": type === "PERSON" ? 1.5 : 1,
      "border-color": ENTITY_COLORS[type].stroke,
      label: "data(label)",
      color: ENTITY_COLORS[type].text,
      "font-family": "Spline Sans Mono, ui-monospace, monospace",
      "font-size": type === "PERSON" ? 9.5 : 7.5,
      "font-weight": type === "PERSON" ? 700 : 600,
      "text-valign": top ? "top" : "bottom",
      "text-margin-y": top ? -7 : 5,
      "text-background-opacity": 0.85,
      "text-background-color": CANVAS_BG,
      "text-background-padding": "3px",
      "text-background-shape": "roundrectangle",
      "text-border-width": 0.5,
      "text-border-color": "#232b37",
      opacity: 1,
    },
  });

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        width: "100%",
        overflow: "hidden",
        position: "relative",
        userSelect: "none",
        background: CANVAS_BG,
        color: "#e8edf2",
        fontFamily: "'Instrument Sans',system-ui,sans-serif",
      }}
    >
      {/* 1. MAIN INTERACTIVE CYTOSCAPE CANVAS */}
      <div
        style={{
          flex: 1,
          height: "100%",
          position: "relative",
          backgroundImage: "radial-gradient(#10141a 1px,transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      >
        <CytoscapeComponent
          elements={elements}
          cy={(cy: Core) => {
            cyRef.current = cy;
          }}
          className="h-full w-full"
          stylesheet={[
            nodeStyle("PERSON", true) as any,
            nodeStyle("ORGANIZATION", false) as any,
            nodeStyle("ACCOUNT", false) as any,
            nodeStyle("LOCATION", false) as any,
            nodeStyle("VEHICLE", false) as any,
            // Selected node focus
            {
              selector: "node:selected",
              style: {
                "background-opacity": 1,
                "border-color": "#e8edf2",
                "border-width": 3,
                color: "#e8edf2",
                opacity: 1,
              },
            },
            // Delicate hairline edges
            {
              selector: "edge",
              style: {
                width: "data(w)",
                "line-color": "#1e2733",
                "curve-style": "bezier",
                opacity: 0.7,
                "target-arrow-shape": "none",
              },
            },
            // Active selected connected edges
            {
              selector: "edge:selected",
              style: {
                width: 2.0,
                "line-color": AC,
                "line-style": "dashed",
                opacity: 1,
              },
            },
          ]}
        />

        {/* 2. TOP-LEFT FLOATING HUD CONTROLS */}
        <div style={{ position: "absolute", top: 16, left: 16, zIndex: 30, display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setShowFilterDrawer(!showFilterDrawer)}
            style={{ ...hudBtn, color: "#e8edf2" }}
          >
            <span style={{ color: AC }}>≡</span> FILTERING OPTIONS
          </button>

          <select
            value={layoutName}
            onChange={(e) => setLayoutName(e.target.value)}
            style={mono({
              height: 28,
              background: "#0b0e12",
              border: "1px solid #1b212b",
              padding: "0 10px",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: ".08em",
              color: "#e8edf2",
              outline: "none",
              cursor: "pointer",
            })}
          >
            <option value="cose">LAYOUT: FORCE (SPATIOUS)</option>
            <option value="concentric">LAYOUT: CONCENTRIC</option>
            <option value="circle">LAYOUT: CIRCLE</option>
            <option value="breadthfirst">LAYOUT: HIERARCHICAL</option>
            <option value="grid">LAYOUT: GRID</option>
          </select>
        </div>

        {/* 3. TOP-RIGHT FLOATING HUD CONTROLS */}
        <div style={{ position: "absolute", top: 16, right: 16, zIndex: 30, display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => cyRef.current?.fit(undefined, 70)} style={hudBtn}>
            RESET VIEW
          </button>
          <button
            onClick={() => {
              if (cyRef.current) {
                const png = cyRef.current.png({ full: true, bg: CANVAS_BG });
                const a = document.createElement("a");
                a.href = png;
                a.download = `Raven_Macro_Graph_${Date.now()}.png`;
                a.click();
              }
            }}
            style={{ ...hudBtn, color: AC }}
          >
            EXPORT PNG
          </button>
        </div>

        {/* 4. LAYER FILTER POP-OUT DRAWER */}
        {showFilterDrawer && (
          <div
            style={{
              position: "absolute",
              top: 56,
              left: 16,
              zIndex: 40,
              width: 260,
              border: "1px solid #1b212b",
              background: "#080b0e",
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #1b212b", paddingBottom: 8 }}>
              <span style={mono({ fontSize: 9, fontWeight: 700, letterSpacing: ".16em", color: AC })}>◈ ENTITY LAYERS</span>
              <button onClick={() => setShowFilterDrawer(false)} style={{ background: "none", border: "none", color: "#5c6773", cursor: "pointer", fontSize: 13 }}>✕</button>
            </div>

            {[
              { key: "people", label: "PEOPLE / SUSPECTS", color: "#ff5a3c", locked: true, checked: true },
              { key: "institutions", label: "FIR CASES & INSTITUTIONS", color: "#e0a63d", locked: false, checked: layerFilters.institutions },
              { key: "accounts", label: "HAWALA / BANK ACCOUNTS", color: AC, locked: false, checked: layerFilters.accounts },
              { key: "vehicles", label: "VEHICLE FLEETS", color: "#b18cff", locked: false, checked: layerFilters.vehicles },
            ].map((l) => (
              <label key={l.key} style={{ display: "flex", alignItems: "center", gap: 9, cursor: l.locked ? "default" : "pointer" }}>
                <input
                  type="checkbox"
                  checked={l.checked}
                  disabled={l.locked}
                  onChange={(e) => !l.locked && setLayerFilter(l.key as "vehicles" | "institutions" | "accounts", e.target.checked)}
                  style={{ accentColor: AC }}
                />
                <span style={{ width: 8, height: 8, background: l.color, flexShrink: 0 }} />
                <span style={mono({ fontSize: 10, letterSpacing: ".06em", color: l.checked ? "#e8edf2" : "#98a4b3" })}>{l.label}</span>
              </label>
            ))}
          </div>
        )}

        {/* 5. BOTTOM-LEFT HUD (LEGEND) */}
        <div style={{ position: "absolute", bottom: 16, left: 16, zIndex: 30 }}>
          <button onClick={() => setShowLegend(!showLegend)} style={{ ...hudBtn, height: 26 }}>
            LEGEND
          </button>
          {showLegend && (
            <div style={{ marginTop: 8, border: "1px solid #1b212b", background: "#080b0e", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { c: "#ff5a3c", t: "SUSPECT / CRIMINAL" },
                { c: "#e0a63d", t: "FIR CASE / SHELL CO" },
                { c: AC, t: "BANK / HAWALA ACCOUNT" },
                { c: "#5ecf9a", t: "SAFEHOUSE / LOCATION" },
                { c: "#b18cff", t: "VEHICLE FLEET" },
              ].map((row) => (
                <div key={row.t} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 8, height: 8, background: row.c }} />
                  <span style={mono({ fontSize: 9, letterSpacing: ".08em", color: "#98a4b3" })}>{row.t}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 6. BOTTOM-RIGHT ZOOM CONTROLS */}
        <div style={{ position: "absolute", bottom: 16, right: 16, zIndex: 30, display: "flex", alignItems: "center", gap: 6, ...mono({ fontSize: 10 }), color: "#5c6773" }}>
          <span style={{ marginRight: 4 }}>{zoomScale.toFixed(2)}×</span>
          <button
            onClick={() => cyRef.current?.zoom(cyRef.current.zoom() * 0.85)}
            style={{ width: 24, height: 24, background: "#0b0e12", border: "1px solid #1b212b", color: "#98a4b3", cursor: "pointer", fontFamily: "inherit" }}
            title="Zoom Out"
          >
            −
          </button>
          <button
            onClick={() => cyRef.current?.zoom(cyRef.current.zoom() * 1.15)}
            style={{ width: 24, height: 24, background: "#0b0e12", border: "1px solid #1b212b", color: "#98a4b3", cursor: "pointer", fontFamily: "inherit" }}
            title="Zoom In"
          >
            +
          </button>
        </div>
      </div>

      {/* 7. CONTEXTUAL INTELLIGENCE FLYOUT DRAWER */}
      {selectedNodeData && (
        <div style={{ width: 320, borderLeft: "1px solid #1b212b", background: "#080b0e", display: "flex", flexDirection: "column", flexShrink: 0, zIndex: 30 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #1b212b" }}>
            <span style={mono({ fontSize: 9, letterSpacing: ".18em", color: AC })}>◈ NODE INTEL</span>
            <button onClick={() => setSelectedNodeData(null)} style={{ background: "none", border: "none", color: "#5c6773", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>✕</button>
          </div>

          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", flex: 1 }}>
            {/* Entity header */}
            <div>
              <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-.01em", color: "#e8edf2" }}>{selectedNodeData.label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                <span
                  style={mono({
                    fontSize: 9,
                    letterSpacing: ".14em",
                    padding: "3px 8px",
                    border: `1px solid ${hexA(ENTITY_COLORS[selectedNodeData.type]?.stroke || "#5c6773", 0.4)}`,
                    color: ENTITY_COLORS[selectedNodeData.type]?.text || "#c9d1d9",
                  })}
                >
                  {selectedNodeData.type === "PERSON" ? "PRIMARY SUSPECT" : selectedNodeData.type}
                </span>
                <span style={mono({ fontSize: 9, color: "#5c6773" })}>ID · {selectedNodeData.id.substring(0, 10).toUpperCase()}</span>
              </div>
            </div>

            {/* Degree & threat tiles */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ border: "1px solid #1b212b", background: "#0b0e12", padding: 11 }}>
                <div style={mono({ fontSize: 8, letterSpacing: ".16em", color: "#5c6773" })}>LINKS</div>
                <div style={mono({ fontSize: 19, fontWeight: 700, color: AC, marginTop: 3 })}>{selectedNodeData.degree}</div>
              </div>
              <div style={{ border: "1px solid #1b212b", background: "#0b0e12", padding: 11 }}>
                <div style={mono({ fontSize: 8, letterSpacing: ".16em", color: "#5c6773" })}>THREAT</div>
                <div style={mono({ fontSize: 19, fontWeight: 700, color: "#ff5a3c", marginTop: 3 })}>{selectedNodeData.threatWeight}%</div>
              </div>
            </div>

            {/* Evidence chain */}
            <div>
              <div style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773", marginBottom: 9 })}>EVIDENCE CHAIN</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {selectedNodeData.evidence.map((ev, i) => (
                  <div key={i} style={{ borderLeft: `2px solid ${acBorder}`, background: "#0b0e12", padding: "9px 11px" }}>
                    <div style={mono({ display: "flex", justifyContent: "space-between", fontSize: 9 })}>
                      <span style={{ color: AC }}>{ev.logId}</span>
                      <span style={{ color: "#5c6773" }}>{ev.time}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#98a4b3", marginTop: 4, lineHeight: 1.45 }}>{ev.text}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Action CTAs */}
            {selectedNodeData.type === "PERSON" && (
              <button
                onClick={() =>
                  openTab({
                    id: `profile-${selectedNodeData.id}`,
                    type: "profile",
                    title: `Profile: ${selectedNodeData.label}`,
                    data: { entityId: selectedNodeData.id, entityName: selectedNodeData.label },
                  })
                }
                style={mono({ height: 38, background: hexA(AC, 0.1), border: `1px solid ${acBorder}`, color: AC, fontSize: 10, fontWeight: 600, letterSpacing: ".14em", cursor: "pointer" })}
              >
                OPEN FULL DOSSIER →
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
              style={mono({ height: 32, background: "transparent", border: "1px solid #1b212b", color: "#98a4b3", fontSize: 9, letterSpacing: ".14em", cursor: "pointer" })}
            >
              ISOLATE 1-HOP NEIGHBORHOOD
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
