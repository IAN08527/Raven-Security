import { useState, useMemo, useRef, useEffect } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type { Core, ElementDefinition } from "cytoscape";
import { useQuery } from "@tanstack/react-query";
import { invokeRaven } from "../../hooks/useInvoke";
import { useCaseStore, type ProfileSubTab } from "../../store/case";
import { RoutineMapPane } from "./RoutineMapPane";
import type { EgoGraph, GraphNode } from "../../types/generated";

interface ProfileWorkspacePaneProps {
  entityId?: string;
  entityName?: string;
}

export function ProfileWorkspacePane({
  entityId = "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332",
  entityName = "Rakesh Sawant",
}: ProfileWorkspacePaneProps) {
  const profileSubTab = useCaseStore((s) => s.profileSubTab);
  const setProfileSubTab = useCaseStore((s) => s.setProfileSubTab);
  const openTab = useCaseStore((s) => s.openTab);

  // Vehicle expansion state starts CLOSED by default per user instruction
  const [expandedVehicle, setExpandedVehicle] = useState<string | null>(null);

  // Ego network controls
  const [hops, setHops] = useState(2);
  const [minWeight, setMinWeight] = useState(5);
  const [selectedAssociate, setSelectedAssociate] = useState<{
    id: string;
    label: string;
    role?: string;
    weight: number;
    evidence: { label: string; kind: string; weight: number }[];
  } | null>(null);

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
        w: n.degree ? Math.max(26, 26 + n.degree * 4) : 28,
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
      {/* Top Profile Header Bar */}
      <div className="flex items-center justify-between border-b border-pd-border bg-pd-surface px-6 py-4 select-none shadow-sm">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="flex h-13 w-13 items-center justify-center rounded-full bg-pd-accent/15 border-2 border-pd-accent text-pd-xl font-bold text-pd-accent shadow-md">
              {entityName.substring(0, 2).toUpperCase()}
            </div>
            <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-pd-success border-2 border-pd-surface" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-pd-2xl font-bold text-pd-text-primary tracking-tight">{entityName}</h1>
              <span className="rounded-full bg-pd-danger/15 border border-pd-danger/30 px-2.5 py-0.5 text-pd-xs font-bold text-pd-danger">
                ACTIVE SUSPECT
              </span>
              <span className="font-mono text-pd-xs text-pd-text-tertiary">ID: {entityId.substring(0, 8)}...</span>
            </div>
            <div className="text-pd-sm text-pd-text-secondary mt-1">
              Primary Alias: <span className="text-pd-text-primary font-semibold italic">"Ricky"</span> • Role: <span className="text-pd-warning font-semibold">Syndicate Leader</span> • Target Level: <span className="text-pd-danger font-semibold">Tier-1 Priority</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => alert(`Exporting complete investigative dossier for ${entityName}...`)}
            className="flex items-center gap-1.5 rounded border border-pd-border bg-pd-elevated px-3 py-1.5 text-pd-xs font-medium text-pd-text-secondary hover:bg-pd-surface hover:text-pd-text-primary transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Dossier
          </button>
          <button
            onClick={() => alert(`Editing profile parameters for ${entityName}...`)}
            className="flex items-center gap-1.5 rounded bg-pd-accent px-3.5 py-1.5 text-pd-xs font-bold text-pd-base hover:bg-pd-accent-hover transition-colors shadow"
          >
            Edit Profile
          </button>
        </div>
      </div>

      {/* Sub-Navigation Tabs Bar */}
      <div className="flex h-10 items-center border-b border-pd-border bg-pd-elevated px-6 select-none">
        <div className="flex items-center gap-2">
          {(
            [
              { id: "general", label: "General Info", icon: "user" },
              { id: "vehicles", label: "Vehicles (2)", icon: "truck" },
              { id: "fir", label: "FIR History (3)", icon: "file" },
              { id: "routines", label: "Routines (Geospatial)", icon: "map" },
              { id: "micronet", label: "Micronet (Ego Graph)", icon: "share" },
            ] as { id: ProfileSubTab; label: string; icon: string }[]
          ).map((t) => {
            const isActive = profileSubTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setProfileSubTab(t.id)}
                className={`flex h-9 items-center gap-2 px-4 text-pd-sm font-semibold transition-colors border-b-2 ${
                  isActive
                    ? "border-b-pd-accent text-pd-accent bg-pd-base shadow-sm"
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
        {/* SUB-TAB 1: GENERAL INFO (PHOTO CARD ON LEFT + IDENTITY/CONTACT DETAILS ON RIGHT) */}
        {profileSubTab === "general" && (
          <div className="h-full p-6 overflow-y-auto space-y-6">
            {/* Unified Primary Dossier Card: (Photo Column on Left + Identity & Contact Data on Right) */}
            <div className="rounded border border-pd-border bg-pd-surface p-6 shadow-sm flex flex-col lg:flex-row gap-6 items-stretch">
              {/* LEFT COLUMN: Suspect Mugshot / Surveillance Portrait Frame */}
              <div className="w-full lg:w-72 rounded border border-pd-border bg-pd-elevated p-4 flex flex-col items-center justify-between space-y-4 shrink-0 shadow-md">
                <div className="w-full relative aspect-[4/4.8] rounded bg-[#0a0f16] border border-pd-border overflow-hidden flex items-center justify-center group shadow-inner">
                  {/* Subtle Background Pattern & Gradient */}
                  <div className="absolute inset-0 bg-[radial-gradient(#1f2937_1px,transparent_1px)] [background-size:12px_12px] opacity-40" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0a0f16] via-transparent to-transparent z-10" />

                  {/* Surveillance Silhouette Portrait Graphic */}
                  <div className="w-full h-full flex flex-col items-center justify-center p-2 relative">
                    <svg className="w-28 h-28 text-pd-accent/70" viewBox="0 0 24 24" fill="currentColor">
                      <path fillRule="evenodd" d="M18.685 19.097A9.723 9.723 0 0021.75 12c0-5.385-4.365-9.75-9.75-9.75S2.25 6.615 2.25 12a9.723 9.723 0 003.065 7.097A9.716 9.716 0 0012 21.75a9.716 9.716 0 006.685-2.653zm-12.54-1.285A7.486 7.486 0 0112 15a7.486 7.486 0 015.855 2.812A8.224 8.224 0 0112 20.25a8.224 8.224 0 01-5.855-2.438zM15.75 9a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" clipRule="evenodd" />
                    </svg>

                    {/* Biometric Target HUD Reticle */}
                    <div className="absolute inset-x-5 inset-y-6 border-2 border-pd-accent/60 rounded-sm pointer-events-none flex flex-col justify-between p-1.5">
                      <div className="flex justify-between text-[9px] font-mono text-pd-accent font-bold">
                        <span>[+] FACE_ID</span>
                        <span>98.4%</span>
                      </div>
                      <div className="text-[9px] font-mono text-pd-accent/90 self-end">
                        OSNET-512
                      </div>
                    </div>
                  </div>

                  {/* Top-Right Surveillance Stamp */}
                  <div className="absolute top-2 right-2 z-20 font-mono text-[9px] text-pd-danger bg-pd-danger/15 px-1.5 py-0.5 rounded border border-pd-danger/30 font-bold flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-pd-danger animate-pulse" />
                    CAM-01
                  </div>

                  {/* Bottom Watermark Stamp */}
                  <div className="absolute bottom-2 left-2 z-20 font-mono text-[10px] text-pd-text-primary bg-pd-base/90 px-2 py-0.5 rounded border border-pd-border/80 font-bold">
                    NAFIS: MUM-8842
                  </div>
                </div>

                {/* Identity Summary Below Photo */}
                <div className="w-full text-center space-y-1 border-t border-pd-border/60 pt-3">
                  <div className="text-pd-base font-bold text-pd-text-primary">{entityName}</div>
                  <div className="font-mono text-pd-sm font-bold text-pd-accent">+91 98765 43210</div>
                  <div className="font-mono text-pd-xs text-pd-text-tertiary">Aadhaar: XXXX-XXXX-4521</div>
                </div>
              </div>

              {/* RIGHT COLUMN: Comprehensive Identity & Contact Coordinates Grid */}
              <div className="flex-1 flex flex-col justify-between space-y-4">
                <div className="flex items-center justify-between border-b border-pd-border/60 pb-2.5">
                  <span className="text-pd-sm font-bold uppercase tracking-wider text-pd-accent flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-pd-accent" />
                    Primary Identity & Residence Coordinates
                  </span>
                  <span className="font-mono text-pd-xs text-pd-text-tertiary">Verified NAFIS Match & CDR Linked</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-y-5 gap-x-8 text-pd-base">
                  <div className="space-y-1">
                    <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">Known Aliases</div>
                    <div className="text-pd-md font-semibold text-pd-warning">"Ricky", "R.V. Sawant"</div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">Date of Birth & Age</div>
                    <div className="font-mono text-pd-md text-pd-text-primary">1987-03-15 (37 Years)</div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">Permanent Account No (PAN)</div>
                    <div className="font-mono text-pd-md text-pd-text-primary font-semibold">ABCPS1234K</div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">Biometric Fingerprint Status</div>
                    <div className="text-pd-success text-pd-sm font-semibold flex items-center gap-2 font-mono">
                      <span className="h-2 w-2 rounded-full bg-pd-success" />
                      NAFIS Match: MUM-8842
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">Burner / Alternate SIM</div>
                    <div className="font-mono text-pd-md font-semibold text-pd-warning">+91 98222 11009 (Jio)</div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">Frequent Cell Tower Pings</div>
                    <div className="text-pd-sm text-pd-text-primary font-mono">Tower MH-MUM-0847 (Dharavi West)</div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">Primary Known Residence Address</div>
                    <div className="text-pd-sm font-medium text-pd-text-primary leading-relaxed">
                      Room 14/B, Dharavi Cross Lane, Behind Municipal School, Dharavi, Mumbai 400017
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">Secondary Location (Safehouse)</div>
                    <div className="text-pd-sm text-pd-text-secondary leading-relaxed">
                      Flat 402, Golden Residency, Andheri East, Mumbai
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 2: Syndicate Hierarchy & Investigative Target Status */}
            <div className="rounded border border-pd-border bg-pd-surface p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-pd-border/60 pb-3">
                <span className="text-pd-sm font-bold uppercase tracking-wider text-pd-accent flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-pd-accent" />
                  Syndicate Hierarchy & Active Case Assignment
                </span>
                <span className="rounded bg-pd-danger/15 text-pd-danger font-mono text-pd-xs px-2.5 py-0.5 font-bold border border-pd-danger/30">
                  CRITICAL TARGET
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-y-5 gap-x-8 text-pd-base">
                <div className="space-y-1">
                  <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">Syndicate Role & Tier</div>
                  <div className="text-pd-md font-bold text-pd-danger">Kingpin (Tier-1 Extortion & Hawala)</div>
                </div>
                <div className="space-y-1">
                  <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">Assigned Investigating Officer</div>
                  <div className="text-pd-md font-medium text-pd-text-primary">Inspector A. Kumar (Crime Branch)</div>
                </div>
                <div className="space-y-1">
                  <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">Surveillance & Re-ID Status</div>
                  <div className="text-pd-sm font-semibold text-pd-success flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-pd-success animate-ping" />
                    CCTV Cam Network Auto-Lock ON
                  </div>
                </div>
              </div>
            </div>

            {/* Section 3: Extracted Forensic Identifiers List */}
            <div className="rounded border border-pd-border bg-pd-surface p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-pd-border/60 pb-3">
                <span className="text-pd-sm font-bold uppercase tracking-wider text-pd-accent flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-pd-accent" />
                  Extracted Digital Identifiers & On-Chain Proofs
                </span>
                <span className="font-mono text-pd-xs text-pd-success">100% SHA-256 Verified</span>
              </div>

              <table className="w-full text-left text-pd-sm">
                <thead>
                  <tr className="text-pd-xs text-pd-text-tertiary uppercase border-b border-pd-border/60 pb-2 h-9">
                    <th className="py-1.5">Type</th>
                    <th className="py-1.5">Identifier Value</th>
                    <th className="py-1.5">Extracted Source Document</th>
                    <th className="py-1.5">Blockchain Hash Integrity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-pd-border/40 font-mono text-pd-sm">
                  <tr className="h-10">
                    <td className="py-2 text-pd-text-secondary font-sans font-semibold">PHONE</td>
                    <td className="py-2 text-pd-accent font-bold">+91 98765 43210</td>
                    <td className="py-2 text-pd-text-secondary font-sans">fir_102_final.pdf (Page 1)</td>
                    <td className="py-2 text-pd-success">Anchored (Block #14209)</td>
                  </tr>
                  <tr className="h-10">
                    <td className="py-2 text-pd-text-secondary font-sans font-semibold">VEHICLE</td>
                    <td className="py-2 text-pd-text-primary font-bold">MH-02-AB-1234 (White Scorpio)</td>
                    <td className="py-2 text-pd-text-secondary font-sans">cctv_log_cam01.csv</td>
                    <td className="py-2 text-pd-success">Anchored (Block #14215)</td>
                  </tr>
                  <tr className="h-10">
                    <td className="py-2 text-pd-text-secondary font-sans font-semibold">BANK_ACC</td>
                    <td className="py-2 text-pd-text-primary font-bold">HDFC-001294820194</td>
                    <td className="py-2 text-pd-text-secondary font-sans">bank_stmt_march.csv</td>
                    <td className="py-2 text-pd-success">Anchored (Block #14218)</td>
                  </tr>
                  <tr className="h-10">
                    <td className="py-2 text-pd-text-secondary font-sans font-semibold">PASSPORT</td>
                    <td className="py-2 text-pd-text-primary font-bold">P-8842910</td>
                    <td className="py-2 text-pd-text-secondary font-sans">immigration_record.pdf</td>
                    <td className="py-2 text-pd-success">Anchored (Block #14220)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SUB-TAB 2: VEHICLES (VERTICAL CARDS, INITIALLY CLOSED) */}
        {profileSubTab === "vehicles" && (
          <div className="h-full p-6 overflow-y-auto space-y-5">
            <div className="flex items-center justify-between border-b border-pd-border pb-2.5">
              <span className="text-pd-sm font-bold uppercase tracking-wider text-pd-text-tertiary">
                Spotted & Registered Vehicle Fleets (Click card to expand connected suspects)
              </span>
              <span className="text-pd-xs text-pd-text-secondary font-mono">2 Linked Vehicles</span>
            </div>

            {/* Vehicle 1 Card */}
            <div
              onClick={() => setExpandedVehicle(expandedVehicle === "MH-02-AB-1234" ? null : "MH-02-AB-1234")}
              className={`rounded border transition-all p-5 space-y-3.5 cursor-pointer shadow-sm ${
                expandedVehicle === "MH-02-AB-1234"
                  ? "border-pd-accent bg-pd-surface"
                  : "border-pd-border bg-pd-surface/80 hover:bg-pd-surface"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-11 w-11 items-center justify-center rounded bg-pd-elevated text-pd-accent border border-pd-border">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                  </div>
                  <div>
                    <span className="font-mono text-pd-xl font-bold text-pd-accent">MH-02-AB-1234</span>
                    <div className="text-pd-sm text-pd-text-secondary mt-0.5">
                      Mahindra Scorpio • White Color • Model 2021
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="rounded bg-pd-danger/15 px-3 py-1 text-pd-xs font-bold text-pd-danger border border-pd-danger/30">
                    PRIMARY CRIME VEHICLE
                  </span>
                  <span className="text-pd-text-tertiary text-pd-sm">
                    {expandedVehicle === "MH-02-AB-1234" ? "▲" : "▼"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-pd-sm text-pd-text-secondary border-t border-pd-border/60 pt-3">
                <div>Registered Owner: <strong className="text-pd-text-primary">Rakesh Vijay Sawant</strong></div>
                <div>Last CCTV Sighting: <strong className="font-mono text-pd-text-primary">CAM-01 Main Gate (14:32)</strong></div>
                <div>VAHAN Status: <strong className="text-pd-success font-medium">Active Commercial Permit</strong></div>
              </div>

              {/* Connected Suspects / Co-Occupants List */}
              {expandedVehicle === "MH-02-AB-1234" && (
                <div className="mt-3 p-4 rounded bg-pd-base border border-pd-border/80 space-y-3 animate-in fade-in duration-100">
                  <div className="text-pd-xs font-bold uppercase tracking-wider text-pd-text-tertiary">
                    Suspects Documented Connected To This Vehicle (3 Persons):
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded bg-pd-elevated p-3 border border-pd-border flex flex-col justify-between">
                      <div>
                        <div className="font-bold text-pd-sm text-pd-text-primary">Rakesh Sawant</div>
                        <div className="text-pd-xs text-pd-text-secondary mt-0.5">Registered Owner & Driver</div>
                      </div>
                      <span className="text-[11px] font-mono text-pd-accent mt-2.5">Active Subject</span>
                    </div>

                    <div className="rounded bg-pd-elevated p-3 border border-pd-border flex flex-col justify-between">
                      <div>
                        <div className="font-bold text-pd-sm text-pd-text-primary">Vikram Patel</div>
                        <div className="text-pd-xs text-pd-text-secondary mt-0.5">Spotted Passenger in FIR-102</div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openTab({
                            id: "profile-8c35e396-4191-5369-9c5c-7ec65df27d5e",
                            type: "profile",
                            title: "Profile: Vikram Patel",
                            data: { entityId: "8c35e396-4191-5369-9c5c-7ec65df27d5e", entityName: "Vikram Patel" },
                          });
                        }}
                        className="mt-2.5 text-left text-pd-xs font-semibold text-pd-accent hover:underline flex items-center gap-1"
                      >
                        Open Profile →
                      </button>
                    </div>

                    <div className="rounded bg-pd-elevated p-3 border border-pd-border flex flex-col justify-between">
                      <div>
                        <div className="font-bold text-pd-sm text-pd-text-primary">Deepak Gaikwad</div>
                        <div className="text-pd-xs text-pd-text-secondary mt-0.5">Tollgate Surveillance Driver</div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openTab({
                            id: "profile-7b4c92a1-3d5f-51e8-9c12-34e56f789abc",
                            type: "profile",
                            title: "Profile: Deepak Kumar",
                            data: { entityId: "7b4c92a1-3d5f-51e8-9c12-34e56f789abc", entityName: "Deepak Kumar" },
                          });
                        }}
                        className="mt-2.5 text-left text-pd-xs font-semibold text-pd-accent hover:underline flex items-center gap-1"
                      >
                        Open Profile →
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Vehicle 2 Card */}
            <div
              onClick={() => setExpandedVehicle(expandedVehicle === "MH-01-XX-9900" ? null : "MH-01-XX-9900")}
              className={`rounded border transition-all p-5 space-y-3.5 cursor-pointer shadow-sm ${
                expandedVehicle === "MH-01-XX-9900"
                  ? "border-pd-accent bg-pd-surface"
                  : "border-pd-border bg-pd-surface/80 hover:bg-pd-surface"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-11 w-11 items-center justify-center rounded bg-pd-elevated text-pd-text-secondary border border-pd-border">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                  </div>
                  <div>
                    <span className="font-mono text-pd-xl font-bold text-pd-text-primary">MH-01-XX-9900</span>
                    <div className="text-pd-sm text-pd-text-secondary mt-0.5">
                      Hyundai Creta • Silver Color • Model 2022
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="rounded bg-pd-warning/15 px-3 py-1 text-pd-xs font-bold text-pd-warning border border-pd-warning/30">
                    ASSOCIATE FLEET
                  </span>
                  <span className="text-pd-text-tertiary text-pd-sm">
                    {expandedVehicle === "MH-01-XX-9900" ? "▲" : "▼"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-pd-sm text-pd-text-secondary border-t border-pd-border/60 pt-3">
                <div>Registered Owner: <strong className="text-pd-text-primary">Vikram Patel</strong></div>
                <div>Spotted Context: <strong className="text-pd-text-primary">FIR-102 Convoys</strong></div>
                <div>Status: <strong className="text-pd-warning">Under Watch</strong></div>
              </div>

              {expandedVehicle === "MH-01-XX-9900" && (
                <div className="mt-3 p-4 rounded bg-pd-base border border-pd-border/80 space-y-3 animate-in fade-in duration-100">
                  <div className="text-pd-xs font-bold uppercase tracking-wider text-pd-text-tertiary">
                    Suspects Connected:
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded bg-pd-elevated p-3 border border-pd-border">
                      <div className="font-bold text-pd-sm text-pd-text-primary">Vikram Patel</div>
                      <div className="text-pd-xs text-pd-text-secondary">Registered Owner</div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openTab({
                            id: "profile-8c35e396-4191-5369-9c5c-7ec65df27d5e",
                            type: "profile",
                            title: "Profile: Vikram Patel",
                            data: { entityId: "8c35e396-4191-5369-9c5c-7ec65df27d5e", entityName: "Vikram Patel" },
                          });
                        }}
                        className="mt-2 text-left text-pd-xs font-semibold text-pd-accent hover:underline flex items-center gap-1"
                      >
                        Open Profile →
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SUB-TAB 3: FIR HISTORY (VERTICAL CARDS WITH NEW DOCUMENT TAB OPENING) */}
        {profileSubTab === "fir" && (
          <div className="h-full p-6 overflow-y-auto space-y-5">
            <div className="flex items-center justify-between border-b border-pd-border pb-2.5">
              <span className="text-pd-sm font-bold uppercase tracking-wider text-pd-text-tertiary">
                Linked FIRs & Criminal Charges (Click to open full document in new tab)
              </span>
              <span className="text-pd-xs text-pd-text-secondary font-mono">3 Registered Cases</span>
            </div>

            {/* FIR 1 Card */}
            <div
              onClick={() => {
                openTab({
                  id: "doc-fir-102",
                  type: "document",
                  title: "Document: FIR-102/2024",
                  data: {
                    firNo: "FIR-102/2024 (Dharavi PS)",
                    policeStation: "Dharavi Police Station, Mumbai",
                    incidentDate: "2024-03-12 21:45 IST",
                    ipcSections: "Sec 302, 384, 120B, Arms Act Sec 25",
                    sha256: "7a3f4c2d1e8b9a0f3e2d1c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f",
                  },
                });
              }}
              className="rounded border border-pd-danger/40 bg-pd-surface p-5 space-y-3 cursor-pointer hover:border-pd-danger transition-all shadow-sm group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-pd-lg font-bold text-pd-danger group-hover:underline">
                    FIR-102/2024 (Dharavi PS)
                  </span>
                  <span className="rounded bg-pd-danger/15 px-2.5 py-0.5 text-pd-xs font-bold text-pd-danger border border-pd-danger/30">
                    HEINOUS / CHARGE-SHEETED
                  </span>
                </div>
                <button className="flex items-center gap-1.5 rounded bg-pd-elevated px-3 py-1.5 text-pd-xs font-semibold text-pd-accent border border-pd-border group-hover:border-pd-accent">
                  View Full Document
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
              </div>

              <div className="text-pd-md font-semibold text-pd-text-primary">
                Armed Extortion, Murder Conspiracy & Illegal Firearms Possession
              </div>

              <div className="text-pd-sm text-pd-text-secondary">
                Acts & Sections: <strong className="font-mono text-pd-danger">IPC Sec 302, 384, 120B & Arms Act Sec 25</strong>
              </div>

              <div className="text-pd-xs text-pd-text-tertiary flex items-center justify-between border-t border-pd-border/60 pt-2.5 font-mono">
                <span>Co-Accused: Vikram Patel, Mohd. Khan</span>
                <span className="text-pd-success">On-Chain Verified (Block #14209)</span>
              </div>
            </div>

            {/* FIR 2 Card */}
            <div
              onClick={() => {
                openTab({
                  id: "doc-fir-044",
                  type: "document",
                  title: "Document: FIR-044/2023",
                  data: {
                    firNo: "FIR-044/2023 (Crime Branch)",
                    policeStation: "Crime Branch CID, Unit 9, Mumbai",
                    incidentDate: "2023-11-04 11:30 IST",
                    ipcSections: "Sec 420 (Cheating), Sec 468 (Forgery), Sec 471 & PMLA Sec 3/4",
                    sha256: "b4e29f1a8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f",
                  },
                });
              }}
              className="rounded border border-pd-warning/40 bg-pd-surface p-5 space-y-3 cursor-pointer hover:border-pd-warning transition-all shadow-sm group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-pd-lg font-bold text-pd-warning group-hover:underline">
                    FIR-044/2023 (Crime Branch CID)
                  </span>
                  <span className="rounded bg-pd-warning/15 px-2.5 py-0.5 text-pd-xs font-bold text-pd-warning border border-pd-warning/30">
                    FINANCIAL FRAUD / HAWALA
                  </span>
                </div>
                <button className="flex items-center gap-1.5 rounded bg-pd-elevated px-3 py-1.5 text-pd-xs font-semibold text-pd-accent border border-pd-border group-hover:border-pd-accent">
                  View Full Document
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
              </div>

              <div className="text-pd-md font-semibold text-pd-text-primary">
                Hawala Fund Layering, Forgery & Shell Company Operation
              </div>

              <div className="text-pd-sm text-pd-text-secondary">
                Acts & Sections: <strong className="font-mono text-pd-warning">IPC Sec 420, 468, 471 & Prevention of Money Laundering Act</strong>
              </div>

              <div className="text-pd-xs text-pd-text-tertiary flex items-center justify-between border-t border-pd-border/60 pt-2.5 font-mono">
                <span>Co-Accused: Anita Roy, Vikram Patel</span>
                <span className="text-pd-success">On-Chain Verified (Block #14210)</span>
              </div>
            </div>
          </div>
        )}

        {/* SUB-TAB 4: ROUTINES (GEOSPATIAL ROUTINE TRACKER MODELED AFTER STITCH DESIGN) */}
        {profileSubTab === "routines" && (
          <RoutineMapPane entityName={entityName} />
        )}

        {/* SUB-TAB 5: MICRONET (EGO GRAPH CANVAS) */}
        {profileSubTab === "micronet" && (
          <div className="flex h-full w-full relative">
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
              <div className="absolute top-4 left-4 z-10 flex items-center gap-2 rounded bg-pd-surface/90 backdrop-blur border border-pd-border p-2 text-pd-xs shadow-lg">
                <span className="text-pd-text-tertiary">Hops:</span>
                <button
                  onClick={() => setHops(Math.max(1, hops - 1))}
                  className="px-2 py-0.5 rounded bg-pd-elevated text-pd-text-secondary hover:text-pd-text-primary"
                >
                  -
                </button>
                <span className="font-mono text-pd-accent font-semibold">{hops}</span>
                <button
                  onClick={() => setHops(Math.min(3, hops + 1))}
                  className="px-2 py-0.5 rounded bg-pd-elevated text-pd-text-secondary hover:text-pd-text-primary"
                >
                  +
                </button>

                <div className="h-3.5 w-px bg-pd-border mx-1" />

                <span className="text-pd-text-tertiary">Min Weight:</span>
                <input
                  type="range"
                  min="1"
                  max="25"
                  value={minWeight}
                  onChange={(e) => setMinWeight(Number(e.target.value))}
                  className="w-20 accent-pd-accent h-1.5 bg-pd-elevated rounded"
                />
                <span className="font-mono text-pd-text-primary">{minWeight}</span>
              </div>
            </div>

            {/* Contextual Slide-out Flyout Drawer */}
            {selectedAssociate && (
              <div className="w-80 border-l border-pd-border bg-pd-surface p-5 flex flex-col justify-between select-none shadow-xl z-20">
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-pd-border pb-2.5">
                    <span className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">
                      Connection Detail
                    </span>
                    <button
                      onClick={() => setSelectedAssociate(null)}
                      className="text-pd-text-tertiary hover:text-pd-text-primary"
                    >
                      ✕
                    </button>
                  </div>

                  <div>
                    <div className="text-pd-md font-bold text-pd-text-primary">
                      {entityName} ↔ {selectedAssociate.label}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between rounded bg-pd-elevated p-2.5 border border-pd-border">
                      <span className="text-pd-xs text-pd-text-secondary">Connection Weight:</span>
                      <span className="font-mono text-pd-base font-bold text-pd-accent">
                        {selectedAssociate.weight}
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="text-pd-xs font-semibold text-pd-text-tertiary mb-2">
                      Supporting Evidence (3 links):
                    </div>
                    <div className="space-y-2 text-pd-xs">
                      {selectedAssociate.evidence.map((ev, i) => (
                        <div
                          key={i}
                          className="rounded bg-pd-base p-2.5 border border-pd-border/60 space-y-1"
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
                  className="mt-4 flex w-full h-9 items-center justify-center gap-1.5 rounded bg-pd-accent text-pd-xs font-bold text-pd-base hover:bg-pd-accent-hover transition-colors shadow"
                >
                  Open Full Profile in New Tab
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
