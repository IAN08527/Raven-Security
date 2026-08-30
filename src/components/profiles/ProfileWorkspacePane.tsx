import { useState, useMemo, useRef, useEffect } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type { Core, ElementDefinition } from "cytoscape";
import { useQuery } from "@tanstack/react-query";
import { invokeRaven } from "../../hooks/useInvoke";
import { useCaseStore, type ProfileSubTab } from "../../store/case";
import type { EgoGraph, GraphNode } from "../../types/generated";

interface ProfileWorkspacePaneProps {
  entityId?: string;
  entityName?: string;
}

const TYPE_COLOR: Record<string, string> = {
  PERSON: "#58a6ff",
  ORGANIZATION: "#d29922",
  LOCATION: "#3fb950",
  VEHICLE: "#bc8cff",
  ACCOUNT: "#f0883e",
};

export function ProfileWorkspacePane({
  entityId = "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332",
  entityName = "Rakesh Sawant",
}: ProfileWorkspacePaneProps) {
  const profileSubTab = useCaseStore((s) => s.profileSubTab);
  const setProfileSubTab = useCaseStore((s) => s.setProfileSubTab);
  const openTab = useCaseStore((s) => s.openTab);

  // Ego network controls
  const [hops, setHops] = useState(2);
  const [minWeight, setMinWeight] = useState(5);
  const [selectedAssociate, setSelectedAssociate] = useState<{
    id: string;
    label: string;
    role?: string;
    weight: number;
    evidence: { label: string; kind: string; weight: number }[];
  } | null>({
    id: "8c35e396-4191-5369-9c5c-7ec65df27d5e",
    label: "Vikram Patel",
    role: "Hawala Operator",
    weight: 35,
    evidence: [
      { label: "Co-accused in FIR-102 (Sec 302/120B)", kind: "fir_text", weight: 25 },
      { label: "47 Telecom Calls logged in 30 days", kind: "cdr_row", weight: 1 },
      { label: "UPI Bank Transfer Rs 2.4L via HDFC", kind: "txn_row", weight: 10 },
    ],
  });

  const cyRef = useRef<Core | null>(null);

  // Query live ego graph for this specific entity
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

  const elements = useMemo<ElementDefinition[]>(() => {
    const data = egoQuery.data;
    if (!data) {
      // Fallback demo ego nodes if backend is loading
      return [
        { data: { id: entityId, label: entityName, type: "PERSON", w: 40 } },
        { data: { id: "p2", label: "Vikram Patel", type: "PERSON", w: 30 } },
        { data: { id: "p3", label: "Mohd. Khan", type: "PERSON", w: 25 } },
        { data: { id: "p4", label: "FIR-102 (Dharavi)", type: "ORGANIZATION", w: 35 } },
        { data: { id: "e1", source: entityId, target: "p2", label: "CO_ACCUSED (35)", w: 4 } },
        { data: { id: "e2", source: entityId, target: "p3", label: "CDR_MATCH (12)", w: 2 } },
        { data: { id: "e3", source: entityId, target: "p4", label: "NAMED_IN (25)", w: 3 } },
      ];
    }
    const nodes: ElementDefinition[] = data.nodes.map((n: GraphNode) => ({
      data: {
        id: n.id,
        label: n.label,
        type: n.type,
        w: n.degree ? Math.max(24, 24 + n.degree * 4) : 28,
      },
    }));
    const edges: ElementDefinition[] = data.edges.map((e) => ({
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        label: `${e.type} (${e.weight})`,
        w: Math.max(1.5, Math.min(6, 1 + e.weight / 15)),
      },
    }));
    return [...nodes, ...edges];
  }, [egoQuery.data, entityId, entityName]);


  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const layout = cy.layout({
      name: "cose",
      animate: false,
      padding: 30,
      nodeRepulsion: () => 8000,
      idealEdgeLength: () => 80,
    });
    layout.run();

    cy.on("select", "node", (evt) => {
      const node = evt.target;
      const data = node.data();
      if (data.id !== entityId) {
        setSelectedAssociate({
          id: data.id,
          label: data.label,
          role: "Associate",
          weight: 35,
          evidence: [
            { label: "Co-accused in FIR-102", kind: "fir_text", weight: 25 },
            { label: "47 Calls logged (March 2024)", kind: "cdr_row", weight: 1 },
            { label: "Direct UPI Transfer Rs 2.4L", kind: "txn_row", weight: 10 },
          ],
        });
      }
    });

    return () => {
      cy.removeListener("select");
    };
  }, [elements, entityId]);

  return (
    <div className="flex h-full flex-col bg-pd-base text-pd-text-primary overflow-hidden">
      {/* Profile Header Card */}
      <div className="flex items-center justify-between border-b border-pd-border bg-pd-surface px-4 py-3 select-none">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pd-accent/15 border-2 border-pd-accent text-pd-lg font-bold text-pd-accent">
            {entityName.substring(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-pd-xl font-semibold text-pd-text-primary">{entityName}</h1>
              <span className="rounded-full bg-pd-danger/15 border border-pd-danger/30 px-2 py-0.5 text-pd-xs font-semibold text-pd-danger">
                ACTIVE SUSPECT
              </span>
              <span className="font-mono text-pd-xs text-pd-text-tertiary">ID: {entityId.substring(0, 8)}...</span>
            </div>
            <div className="text-pd-xs text-pd-text-secondary mt-0.5">
              Primary Alias: <span className="text-pd-text-primary italic">"Ricky"</span> • Syndicate Leader (Level 1 Target) • Case: OP-RAVEN-01
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => alert(`Exporting dossier for ${entityName}...`)}
            className="flex items-center gap-1.5 rounded-sm border border-pd-border bg-pd-elevated px-2.5 py-1 text-pd-xs text-pd-text-secondary hover:bg-pd-surface hover:text-pd-text-primary transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Dossier
          </button>
          <button
            onClick={() => alert(`Editing profile for ${entityName}...`)}
            className="flex items-center gap-1.5 rounded-sm bg-pd-accent px-3 py-1 text-pd-xs font-medium text-pd-base hover:bg-pd-accent-hover transition-colors"
          >
            Edit Profile
          </button>
        </div>
      </div>

      {/* Sub-Navigation Tabs Bar */}
      <div className="flex h-8.5 items-center border-b border-pd-border bg-pd-elevated px-3 select-none">
        <div className="flex items-center gap-1">
          {(
            [
              { id: "general", label: "General Info", icon: "user" },
              { id: "vehicles", label: "Vehicles (2)", icon: "truck" },
              { id: "fir", label: "FIR History (3)", icon: "file" },
              { id: "micronet", label: "Micronet (Ego Graph)", icon: "share" },
            ] as { id: ProfileSubTab; label: string; icon: string }[]
          ).map((t) => {
            const isActive = profileSubTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setProfileSubTab(t.id)}
                className={`flex h-8 items-center gap-1.5 px-3 text-pd-xs font-medium transition-colors border-b-2 ${
                  isActive
                    ? "border-b-pd-accent text-pd-accent bg-pd-base"
                    : "border-b-transparent text-pd-text-secondary hover:text-pd-text-primary hover:bg-pd-surface/60"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Sub-Tab Content */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {/* SUB-TAB 1: GENERAL INFO */}
        {profileSubTab === "general" && (
          <div className="h-full p-4 overflow-y-auto space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Identity Card */}
              <div className="rounded-sm border border-pd-border bg-pd-surface p-3.5 space-y-3">
                <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary border-b border-pd-border/60 pb-1.5">
                  Identity & Personal Details
                </div>
                <div className="grid grid-cols-2 gap-3 text-pd-sm">
                  <div>
                    <div className="text-pd-xs text-pd-text-tertiary">Full Legal Name</div>
                    <div className="font-medium text-pd-text-primary">Rakesh Vijay Sawant</div>
                  </div>
                  <div>
                    <div className="text-pd-xs text-pd-text-tertiary">Aliases</div>
                    <div className="font-medium text-pd-text-primary">Ricky, R.V. Sawant</div>
                  </div>
                  <div>
                    <div className="text-pd-xs text-pd-text-tertiary">Date of Birth / Age</div>
                    <div className="font-mono text-pd-text-primary">1987-03-15 (37 yrs)</div>
                  </div>
                  <div>
                    <div className="text-pd-xs text-pd-text-tertiary">Gender</div>
                    <div className="text-pd-text-primary">Male</div>
                  </div>
                  <div>
                    <div className="text-pd-xs text-pd-text-tertiary">Masked Aadhaar ID</div>
                    <div className="font-mono text-pd-text-primary">XXXX-XXXX-4521</div>
                  </div>
                  <div>
                    <div className="text-pd-xs text-pd-text-tertiary">PAN Number</div>
                    <div className="font-mono text-pd-text-primary">ABCPS1234K</div>
                  </div>
                </div>
              </div>

              {/* Contact & Location Card */}
              <div className="rounded-sm border border-pd-border bg-pd-surface p-3.5 space-y-3">
                <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary border-b border-pd-border/60 pb-1.5">
                  Contact & Location Intelligence
                </div>
                <div className="grid grid-cols-2 gap-3 text-pd-sm">
                  <div>
                    <div className="text-pd-xs text-pd-text-tertiary">Primary Phone</div>
                    <div className="font-mono text-pd-accent">+91 98765 43210 (Airtel)</div>
                  </div>
                  <div>
                    <div className="text-pd-xs text-pd-text-tertiary">Secondary Phone</div>
                    <div className="font-mono text-pd-accent">+91 98222 11009 (Jio)</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-pd-xs text-pd-text-tertiary">Last Known Primary Address</div>
                    <div className="text-pd-text-primary">14/B, Dharavi Cross Lane, Dharavi, Mumbai 400017</div>
                  </div>
                  <div>
                    <div className="text-pd-xs text-pd-text-tertiary">Registered Vehicles</div>
                    <div className="font-mono text-pd-text-primary">MH-02-AB-1234, MH-01-XX-9900</div>
                  </div>
                  <div>
                    <div className="text-pd-xs text-pd-text-tertiary">NAFIS Biometric Fingerprint</div>
                    <div className="font-mono text-pd-success flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-pd-success" />
                      Verified Match (MUM-8842)
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Identifiers Table */}
            <div className="rounded-sm border border-pd-border bg-pd-surface p-3.5">
              <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary border-b border-pd-border/60 pb-2 mb-2">
                All Extracted Digital Identifiers
              </div>
              <table className="w-full text-left text-pd-xs">
                <thead>
                  <tr className="text-pd-text-tertiary border-b border-pd-border/40 pb-1">
                    <th className="py-1">Type</th>
                    <th className="py-1">Identifier Value</th>
                    <th className="py-1">Source Document</th>
                    <th className="py-1">Integrity Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-pd-border/20 font-mono">
                  <tr>
                    <td className="py-1 text-pd-text-secondary">PHONE</td>
                    <td className="py-1 text-pd-accent">+91 98765 43210</td>
                    <td className="py-1 text-pd-text-secondary">fir_102_final.pdf</td>
                    <td className="py-1 text-pd-success">Anchored (SHA-256)</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-pd-text-secondary">VEHICLE</td>
                    <td className="py-1 text-pd-text-primary">MH-02-AB-1234 (White Scorpio)</td>
                    <td className="py-1 text-pd-text-secondary">cctv_log_cam01.csv</td>
                    <td className="py-1 text-pd-success">Anchored (SHA-256)</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-pd-text-secondary">BANK_ACC</td>
                    <td className="py-1 text-pd-text-primary">HDFC-001294820194</td>
                    <td className="py-1 text-pd-text-secondary">bank_stmt_march.csv</td>
                    <td className="py-1 text-pd-success">Anchored (SHA-256)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SUB-TAB 2: VEHICLES */}
        {profileSubTab === "vehicles" && (
          <div className="h-full p-4 overflow-y-auto space-y-3">
            <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">
              Spotted & Registered Vehicles
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded border border-pd-border bg-pd-surface p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-pd-base font-bold text-pd-accent">MH-02-AB-1234</span>
                  <span className="rounded bg-pd-danger/15 px-2 py-0.5 text-[10px] font-bold text-pd-danger border border-pd-danger/30">
                    SUSPECT VEHICLE
                  </span>
                </div>
                <div className="text-pd-xs text-pd-text-secondary">
                  Make / Model: <span className="text-pd-text-primary">Mahindra Scorpio (White, 2021)</span>
                </div>
                <div className="text-pd-xs text-pd-text-secondary">
                  Last Spotted: <span className="font-mono text-pd-text-primary">2024-08-28 14:32:00</span> via CAM-01 (Main Gate)
                </div>
                <div className="text-pd-xs text-pd-text-secondary">
                  Registered Owner: <span className="text-pd-text-primary">Rakesh Vijay Sawant</span> (VAHAN record linked)
                </div>
              </div>

              <div className="rounded border border-pd-border bg-pd-surface p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-pd-base font-bold text-pd-text-primary">MH-01-XX-9900</span>
                  <span className="rounded bg-pd-warning/15 px-2 py-0.5 text-[10px] font-bold text-pd-warning border border-pd-warning/30">
                    ASSOCIATE REGISTERED
                  </span>
                </div>
                <div className="text-pd-xs text-pd-text-secondary">
                  Make / Model: <span className="text-pd-text-primary">Hyundai Creta (Silver)</span>
                </div>
                <div className="text-pd-xs text-pd-text-secondary">
                  Spotted In: <span className="text-pd-text-primary">FIR-102 co-location scene</span>
                </div>
                <div className="text-pd-xs text-pd-text-secondary">
                  Registered Owner: <span className="text-pd-text-primary">Vikram Patel</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUB-TAB 3: FIR HISTORY */}
        {profileSubTab === "fir" && (
          <div className="h-full p-4 overflow-y-auto space-y-3">
            <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">
              Linked FIRs & Crime Offenses Record
            </div>
            <div className="space-y-2.5">
              <div className="rounded border border-pd-border bg-pd-surface p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-pd-sm font-bold text-pd-danger">FIR-102/2024 (Dharavi PS)</span>
                  <span className="text-pd-xs font-mono text-pd-text-tertiary">Date: 2024-03-12</span>
                </div>
                <div className="text-pd-sm font-medium text-pd-text-primary">
                  Organized Syndicate Extortion & Armed Conspiracy
                </div>
                <div className="text-pd-xs text-pd-text-secondary">
                  IPC Sections: <span className="font-mono text-pd-accent">Sec 302, 384, 120B, Arms Act Sec 25</span>
                </div>
                <div className="text-pd-xs text-pd-text-tertiary">
                  Co-accused: Vikram Patel, Mohd. Khan • Evidence: Audio wiretap (SHA: 7a3f...c2d1)
                </div>
              </div>

              <div className="rounded border border-pd-border bg-pd-surface p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-pd-sm font-bold text-pd-warning">FIR-044/2023 (Crime Branch Mumbai)</span>
                  <span className="text-pd-xs font-mono text-pd-text-tertiary">Date: 2023-11-04</span>
                </div>
                <div className="text-pd-sm font-medium text-pd-text-primary">
                  Hawala Routing & Illicit Money Laundering (PMLA)
                </div>
                <div className="text-pd-xs text-pd-text-secondary">
                  IPC Sections: <span className="font-mono text-pd-accent">Sec 420, 468, 471</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUB-TAB 4: MICRONET (EGO GRAPH CANVAS) */}
        {profileSubTab === "micronet" && (
          <div className="flex h-full w-full relative">
            {/* Cytoscape Canvas */}
            <div className="flex-1 h-full bg-pd-base relative">
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
                    selector: `node[id = "${entityId}"]`,
                    style: {
                      "background-color": "#58a6ff",
                      "border-color": "#79c0ff",
                      "border-width": 3,
                      width: 44,
                      height: 44,
                      "font-weight": "bold",
                    },
                  },
                  {
                    selector: "edge",
                    style: {
                      width: "data(w)",
                      "line-color": "#58a6ff",
                      "target-arrow-color": "#58a6ff",
                      "target-arrow-shape": "triangle",
                      "curve-style": "bezier",
                      "font-size": 9,
                      color: "#8b949e",
                      label: "data(label)",
                    },
                  },
                ]}
              />

              {/* Floating Controls */}
              <div className="absolute top-3 left-3 z-10 flex items-center gap-2 rounded bg-pd-surface/90 backdrop-blur border border-pd-border p-1.5 text-pd-xs shadow-lg">
                <span className="text-pd-text-tertiary">Hops:</span>
                <button
                  onClick={() => setHops(Math.max(1, hops - 1))}
                  className="px-1.5 py-0.5 rounded bg-pd-elevated text-pd-text-secondary hover:text-pd-text-primary"
                >
                  -
                </button>
                <span className="font-mono text-pd-accent font-semibold">{hops}</span>
                <button
                  onClick={() => setHops(Math.min(3, hops + 1))}
                  className="px-1.5 py-0.5 rounded bg-pd-elevated text-pd-text-secondary hover:text-pd-text-primary"
                >
                  +
                </button>

                <div className="h-3 w-px bg-pd-border mx-1" />

                <span className="text-pd-text-tertiary">Min Weight:</span>
                <input
                  type="range"
                  min="1"
                  max="25"
                  value={minWeight}
                  onChange={(e) => setMinWeight(Number(e.target.value))}
                  className="w-16 accent-pd-accent h-1.5 bg-pd-elevated rounded"
                />
                <span className="font-mono text-pd-text-primary">{minWeight}</span>
              </div>
            </div>

            {/* Contextual Slide-out Flyout Drawer */}
            {selectedAssociate && (
              <div className="w-72 border-l border-pd-border bg-pd-surface p-3.5 flex flex-col justify-between select-none shadow-xl z-20">
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-pd-border pb-2">
                    <span className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">
                      Connection Detail
                    </span>
                    <button
                      onClick={() => setSelectedAssociate(null)}
                      className="text-pd-text-tertiary hover:text-pd-text-primary"
                    >
                      ×
                    </button>
                  </div>

                  {/* Associate Name & Weight */}
                  <div>
                    <div className="text-pd-sm font-semibold text-pd-text-primary">
                      {entityName} ↔ {selectedAssociate.label}
                    </div>
                    <div className="mt-1 flex items-center justify-between rounded bg-pd-elevated p-2 border border-pd-border">
                      <span className="text-pd-xs text-pd-text-secondary">Connection Weight:</span>
                      <span className="font-mono text-pd-sm font-bold text-pd-accent">
                        {selectedAssociate.weight}
                      </span>
                    </div>
                  </div>

                  {/* Evidence Breakdown */}
                  <div>
                    <div className="text-pd-xs font-semibold text-pd-text-tertiary mb-1.5">
                      Supporting Evidence (3 links):
                    </div>
                    <div className="space-y-1.5 text-pd-xs">
                      {selectedAssociate.evidence.map((ev, i) => (
                        <div
                          key={i}
                          className="rounded bg-pd-base p-2 border border-pd-border/60 space-y-0.5"
                        >
                          <div className="text-pd-text-primary font-medium">{ev.label}</div>
                          <div className="flex items-center justify-between text-pd-text-tertiary font-mono text-[10px]">
                            <span>{ev.kind}</span>
                            <span className="text-pd-success font-semibold">+{ev.weight}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Primary CTA: Open in New Tab */}
                <button
                  onClick={() => {
                    openTab({
                      id: `profile-${selectedAssociate.id}`,
                      type: "profile",
                      title: `Profile: ${selectedAssociate.label}`,
                      data: {
                        entityId: selectedAssociate.id,
                        entityName: selectedAssociate.label,
                      },
                    });
                  }}
                  className="mt-4 flex w-full h-8 items-center justify-center gap-1.5 rounded bg-pd-accent text-pd-xs font-semibold text-pd-base hover:bg-pd-accent-hover transition-colors shadow"
                >
                  Open Full Profile in New Tab
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
