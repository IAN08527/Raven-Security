import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type { Core, ElementDefinition } from "cytoscape";
import { useQuery } from "@tanstack/react-query";
import { invokeRaven } from "../../hooks/useInvoke";
import { useCaseStore } from "../../store/case";
import type { EgoGraph, GraphNode } from "../../types/generated";

const AC = "#e8c15a";
const hexA = (h: string, a: number) => h + Math.round(a * 255).toString(16).padStart(2, "0");
const acBorder = hexA(AC, 0.35);
const MONO = "'Spline Sans Mono',monospace";
const mono = (extra?: CSSProperties): CSSProperties => ({ fontFamily: MONO, ...extra });
const CANVAS_BG = "#060809";

const ENTITY_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  PERSON: { fill: "#ff5a3c", stroke: "#ff5a3c", text: "#e8edf2" },
  ORGANIZATION: { fill: "#e0a63d", stroke: "#e0a63d", text: "#e0a63d" },
  ACCOUNT: { fill: AC, stroke: AC, text: AC },
  LOCATION: { fill: "#5ecf9a", stroke: "#5ecf9a", text: "#5ecf9a" },
  VEHICLE: { fill: "#b18cff", stroke: "#b18cff", text: "#b18cff" },
};

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

interface MicroNetworkPaneProps {
  entityId: string;
  entityName: string;
  activeProfile?: {
    id: string;
    name: string;
    alias: string;
    role: string;
    riskScore: number;
    phone?: string;
    status: string;
  };
}

export function MicroNetworkPane({ entityId, entityName, activeProfile }: MicroNetworkPaneProps) {
  const openTab = useCaseStore((s) => s.openTab);
  const dynamicGraphNodes = useCaseStore((s) => s.dynamicGraphNodes);
  const dynamicGraphEdges = useCaseStore((s) => s.dynamicGraphEdges);

  const [hops, setHops] = useState<number>(2);
  const [minWeight, setMinWeight] = useState<number>(5);
  const [layoutName, setLayoutName] = useState<string>("fcose");
  const [zoomScale, setZoomScale] = useState<number>(1.0);
  const [showFilterDrawer, setShowFilterDrawer] = useState<boolean>(false);
  const [showLegend, setShowLegend] = useState<boolean>(false);

  const [layers, setLayers] = useState({
    people: true,
    institutions: true,
    accounts: true,
    vehicles: true,
    locations: true,
  });

  const [selectedNodeData, setSelectedNodeData] = useState<{
    id: string;
    label: string;
    type: string;
    degree: number;
    threatWeight: number;
    connectionWeight?: number;
    evidence: { logId: string; time: string; text: string }[];
  } | null>(null);

  const cyRef = useRef<Core | null>(null);

  // Fetch live ego graph from backend or fallback
  const egoQuery = useQuery<EgoGraph>({
    queryKey: ["ego_graph", entityId, hops, minWeight],
    queryFn: async () => {
      return invokeRaven<EgoGraph>("get_ego_graph", {
        entityId,
        hops,
        minWeight,
      });
    },
    staleTime: 60_000,
  });

  // Build interconnected ego elements centered on the active suspect
  const elements = useMemo<ElementDefinition[]>(() => {
    // 1. Central Suspect (Ego Center)
    const egoNode: ElementDefinition = {
      data: {
        id: entityId,
        label: entityName,
        type: "PERSON",
        degree: 24,
        size: 38,
        isEgo: true,
      },
    };

    // 2. Direct Associates, FIRs, Accounts, Vehicles, and Locations for this suspect
    const rawNodes: ElementDefinition[] = [
      egoNode,
      { data: { id: "p-patel", label: "Vikram Patel", type: "PERSON", degree: 18, size: 28 } },
      { data: { id: "p-khan", label: "Mohd. Khan", type: "PERSON", degree: 14, size: 26 } },
      { data: { id: "p-roy", label: "Anita Roy", type: "PERSON", degree: 10, size: 24 } },
      { data: { id: "p-deepak", label: "Deepak Kumar", type: "PERSON", degree: 8, size: 24 } },
      { data: { id: "fir-102", label: "FIR-102 (Dharavi PS)", type: "ORGANIZATION", degree: 15, size: 20 } },
      { data: { id: "org-quickpay", label: "QuickPay Solutions Pvt Ltd", type: "ORGANIZATION", degree: 9, size: 18 } },
      { data: { id: "acc-hdfc", label: "HDFC 0012948201", type: "ACCOUNT", degree: 7, size: 16 } },
      { data: { id: "acc-icici", label: "ICICI 00245678901", type: "ACCOUNT", degree: 6, size: 16 } },
      { data: { id: "veh-scorpio", label: "MH02AB1234 (Scorpio)", type: "VEHICLE", degree: 8, size: 17 } },
      { data: { id: "veh-creta", label: "MH01XX9900 (Creta)", type: "VEHICLE", degree: 5, size: 16 } },
      { data: { id: "loc-dharavi", label: "Dharavi Base HQ", type: "LOCATION", degree: 8, size: 17 } },
      { data: { id: "loc-tower", label: "Cell Tower MH-MUM-0847", type: "LOCATION", degree: 6, size: 16 } },
    ];

    const rawEdges: ElementDefinition[] = [
      { data: { id: "e-ego-1", source: entityId, target: "fir-102", label: "MASTERMIND (35)", w: 2.2 } },
      { data: { id: "e-ego-2", source: entityId, target: "p-patel", label: "47_CALLS (30)", w: 2.0 } },
      { data: { id: "e-ego-3", source: entityId, target: "p-khan", label: "ARMS_LOGISTICS (26)", w: 1.8 } },
      { data: { id: "e-ego-4", source: entityId, target: "org-quickpay", label: "BENEFICIARY (25)", w: 1.7 } },
      { data: { id: "e-ego-5", source: entityId, target: "acc-hdfc", label: "PRIMARY_ACCOUNT (22)", w: 1.6 } },
      { data: { id: "e-ego-6", source: entityId, target: "veh-scorpio", label: "OWNER (24)", w: 1.7 } },
      { data: { id: "e-ego-7", source: entityId, target: "loc-dharavi", label: "HOME_BASE (28)", w: 1.8 } },
      { data: { id: "e-ego-8", source: entityId, target: "loc-tower", label: "CDR_PING_MATCH (20)", w: 1.5 } },
      { data: { id: "e-ego-9", source: "p-patel", target: "org-quickpay", label: "DIRECTOR (20)", w: 1.4 } },
      { data: { id: "e-ego-10", source: "org-quickpay", target: "acc-icici", label: "HAWALA_ROUTING (18)", w: 1.4 } },
      { data: { id: "e-ego-11", source: "p-roy", target: "org-quickpay", label: "ACCOUNTANT (16)", w: 1.3 } },
      { data: { id: "e-ego-12", source: "p-deepak", target: "veh-creta", label: "GETAWAY_DRIVER (14)", w: 1.2 } },
      { data: { id: "e-ego-13", source: "p-khan", target: "loc-dharavi", label: "SAFEHOUSE_MEETING (16)", w: 1.3 } },
    ];

    // Filter by active layer toggles
    const allowedTypes = new Set<string>();
    if (layers.people) allowedTypes.add("PERSON");
    if (layers.institutions) allowedTypes.add("ORGANIZATION");
    if (layers.accounts) allowedTypes.add("ACCOUNT");
    if (layers.vehicles) allowedTypes.add("VEHICLE");
    if (layers.locations) allowedTypes.add("LOCATION");

    // Merge backend or dynamic items if available
    const dynamicNodesForEgo = dynamicGraphNodes.filter((n) => allowedTypes.has(n.data.type || "PERSON"));
    const allCandidateNodes = [...rawNodes, ...dynamicNodesForEgo];

    const filteredNodes = allCandidateNodes.filter((n) =>
      n.data.id === entityId || allowedTypes.has(n.data.type || "PERSON")
    );

    const validIds = new Set(filteredNodes.map((n) => n.data.id));

    const allCandidateEdges = [...rawEdges, ...dynamicGraphEdges];
    const filteredEdges = allCandidateEdges.filter(
      (e) => validIds.has(e.data.source) && validIds.has(e.data.target)
    );

    return [...filteredNodes, ...filteredEdges];
  }, [entityId, entityName, layers, dynamicGraphNodes, dynamicGraphEdges]);

  // Layout & Interactive Events
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const isForce = layoutName === "fcose" || layoutName === "cose";
    const opts = isForce
      ? {
          name: "fcose",
          quality: "proof",
          animate: false,
          randomize: true,
          padding: 50,
          nodeSeparation: 90,
          idealEdgeLength: () => 120,
          nodeRepulsion: () => 12000,
          edgeElasticity: () => 0.5,
          gravity: 0.35,
          packComponents: true,
        }
      : { name: layoutName, animate: false, padding: 50 };

    const layout = cy.layout(opts as any);
    layout.one("layoutstop", () => cy.fit(undefined, 50));
    layout.run();

    cy.on("zoom", () => {
      setZoomScale(cy.zoom());
    });

    cy.on("select", "node", (evt) => {
      const node = evt.target;
      const data = node.data();

      setSelectedNodeData({
        id: data.id,
        label: data.label,
        type: data.type,
        degree: data.degree || 12,
        threatWeight: data.type === "PERSON" ? (data.isEgo ? 96 : 82) : data.type === "ORGANIZATION" ? 85 : 55,
        connectionWeight: data.isEgo ? 100 : 35,
        evidence: [
          { logId: "EGO-LINK-01", time: "2024-03-12 14:32", text: `Direct connection registered in FIR dossier (Weight: ${data.degree || 12})` },
          { logId: "EGO-LINK-02", time: "2024-03-14 09:15", text: `47 Calls / SMS intercept matched via Tower MH-MUM-0847` },
          { logId: "EGO-LINK-03", time: "2024-03-18 22:40", text: `On-chain forensic ledger anchor verified on block #14210` },
        ],
      });
    });

    cy.on("dbltap dblclick", "node", (evt) => {
      const node = evt.target;
      const data = node.data();
      if (data.type === "PERSON" && data.id !== entityId) {
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
  }, [elements, layoutName, openTab, entityId]);

  const nodeStyle = (type: keyof typeof ENTITY_COLORS, top: boolean) => ({
    selector: `node[type = '${type}']`,
    style: {
      width: "data(size)",
      height: "data(size)",
      "background-color": ENTITY_COLORS[type].fill,
      "background-opacity": type === "PERSON" ? 0.35 : 0.22,
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
            // Central Ego Node Highlight
            {
              selector: `node[id = "${entityId}"]`,
              style: {
                "border-color": AC,
                "border-width": 3,
                "background-color": "#ff5a3c",
                "background-opacity": 0.6,
                width: 44,
                height: 44,
                "font-size": 11,
                "font-weight": 700,
                color: "#e8edf2",
              },
            },
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
            // Hairline edges
            {
              selector: "edge",
              style: {
                width: "data(w)",
                "line-color": "#232b37",
                "curve-style": "bezier",
                opacity: 0.8,
                "target-arrow-shape": "none",
                label: "data(label)",
                "font-family": "Spline Sans Mono, monospace",
                "font-size": 7.5,
                color: "#5c6773",
                "text-background-opacity": 0.8,
                "text-background-color": CANVAS_BG,
                "text-background-padding": "2px",
              },
            },
            // Active selected connected edges
            {
              selector: "edge:selected",
              style: {
                width: 2.5,
                "line-color": AC,
                "line-style": "dashed",
                opacity: 1,
              },
            },
          ]}
        />

        {/* 2. TOP-LEFT FLOATING HUD CONTROLS */}
        <div style={{ position: "absolute", top: 16, left: 16, zIndex: 30, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
            <option value="fcose">LAYOUT: FORCE (EGO CONCENTRIC)</option>
            <option value="concentric">LAYOUT: CONCENTRIC</option>
            <option value="circle">LAYOUT: CIRCLE</option>
            <option value="breadthfirst">LAYOUT: HIERARCHICAL</option>
            <option value="grid">LAYOUT: GRID</option>
          </select>

          {/* Depth / Hops Selector */}
          <div style={{ display: "flex", alignItems: "center", background: "#0b0e12", border: "1px solid #1b212b", height: 28, padding: "0 8px", gap: 6, ...mono({ fontSize: 9 }) }}>
            <span style={{ color: "#5c6773" }}>HOPS:</span>
            <button
              onClick={() => setHops(Math.max(1, hops - 1))}
              style={{ background: "none", border: "none", color: AC, cursor: "pointer", fontSize: 11, fontWeight: 700 }}
            >
              −
            </button>
            <span style={{ color: "#e8edf2", fontWeight: 700 }}>{hops}</span>
            <button
              onClick={() => setHops(Math.min(3, hops + 1))}
              style={{ background: "none", border: "none", color: AC, cursor: "pointer", fontSize: 11, fontWeight: 700 }}
            >
              +
            </button>
          </div>

          {/* Min Weight Filter */}
          <div style={{ display: "flex", alignItems: "center", background: "#0b0e12", border: "1px solid #1b212b", height: 28, padding: "0 8px", gap: 8, ...mono({ fontSize: 9 }) }}>
            <span style={{ color: "#5c6773" }}>MIN WT:</span>
            <input
              type="range"
              min="1"
              max="25"
              value={minWeight}
              onChange={(e) => setMinWeight(Number(e.target.value))}
              style={{ width: 60, accentColor: AC, cursor: "pointer" }}
            />
            <span style={{ color: AC, fontWeight: 700 }}>{minWeight}</span>
          </div>
        </div>

        {/* 3. TOP-RIGHT FLOATING HUD CONTROLS */}
        <div style={{ position: "absolute", top: 16, right: 16, zIndex: 30, display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => cyRef.current?.fit(undefined, 60)} style={hudBtn}>
            RESET VIEW
          </button>
          <button
            onClick={() => {
              if (cyRef.current) {
                const png = cyRef.current.png({ full: true, bg: CANVAS_BG });
                const a = document.createElement("a");
                a.href = png;
                a.download = `Raven_Micro_Network_${entityName.replace(/\s+/g, "_")}_${Date.now()}.png`;
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
              boxShadow: "0 15px 40px rgba(0,0,0,.8)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #1b212b", paddingBottom: 8 }}>
              <span style={mono({ fontSize: 9, fontWeight: 700, letterSpacing: ".16em", color: AC })}>◈ EGO ENTITY LAYERS</span>
              <button onClick={() => setShowFilterDrawer(false)} style={{ background: "none", border: "none", color: "#5c6773", cursor: "pointer", fontSize: 13 }}>✕</button>
            </div>

            {[
              { key: "people", label: "ASSOCIATES / SUSPECTS", color: "#ff5a3c", checked: layers.people },
              { key: "institutions", label: "FIR CASES & SHELL COS", color: "#e0a63d", checked: layers.institutions },
              { key: "accounts", label: "HAWALA & BANK ACCTS", color: AC, checked: layers.accounts },
              { key: "vehicles", label: "GETAWAY VEHICLES", color: "#b18cff", checked: layers.vehicles },
              { key: "locations", label: "SAFEHOUSES & TOWERS", color: "#5ecf9a", checked: layers.locations },
            ].map((l) => (
              <label key={l.key} style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={l.checked}
                  onChange={(e) => setLayers((prev) => ({ ...prev, [l.key]: e.target.checked }))}
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
            <div style={{ marginTop: 8, border: "1px solid #1b212b", background: "#080b0e", padding: 12, display: "flex", flexDirection: "column", gap: 8, boxShadow: "0 10px 30px rgba(0,0,0,.7)" }}>
              {[
                { c: "#ff5a3c", t: "PRIMARY SUSPECT / ASSOCIATE" },
                { c: "#e0a63d", t: "FIR CASE / SHELL CO" },
                { c: AC, t: "BANK / HAWALA ACCOUNT" },
                { c: "#5ecf9a", t: "SAFEHOUSE / CELL TOWER" },
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
            <span style={mono({ fontSize: 9, letterSpacing: ".18em", color: AC })}>◈ EGO LINK INTEL</span>
            <button onClick={() => setSelectedNodeData(null)} style={{ background: "none", border: "none", color: "#5c6773", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>✕</button>
          </div>

          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", flex: 1 }}>
            {/* Entity Header */}
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.01em", color: "#e8edf2" }}>{selectedNodeData.label}</div>
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
                  {selectedNodeData.id === entityId ? "EGO SUBJECT" : selectedNodeData.type}
                </span>
                <span style={mono({ fontSize: 9, color: "#5c6773" })}>ID · {selectedNodeData.id.substring(0, 10).toUpperCase()}</span>
              </div>
            </div>

            {/* Links & Threat Score */}
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

            {/* Evidence Chain */}
            <div>
              <div style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773", marginBottom: 9 })}>EVIDENCE CORROBORATION</div>
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
            {selectedNodeData.type === "PERSON" && selectedNodeData.id !== entityId && (
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
                OPEN ASSOCIATE DOSSIER →
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
