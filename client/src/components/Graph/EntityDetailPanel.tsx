import { useState } from "react";
import type { EntityDetail, GraphEdge } from "../../types/api";
import { NODE_STYLE } from "./NetworkGraph";

interface EntityDetailPanelProps {
  detail: EntityDetail | null;
  caseId: string;
  incidentEdges: GraphEdge[];
  onSelectEdge: (edgeId: string) => void;
  onOpenProfile: (entityId: string) => void;
  onClose: () => void;
}

type Tab = "Overview" | "Relations" | "Evidence" | "Activity";

/**
 * M4-T5. Right side panel for the selected node: name, type badge,
 * identifiers, associated case, and tabs. No risk score section: PRD §5
 * excludes risk scoring of individuals (API_CONTRACTS.md §2.5), so there
 * is nothing truthful to display here. Notes live in the Entity Profile
 * screen, which owns the annotation endpoint. The Activity tab lists the
 * record the system actually holds (identifiers, aliases, incident
 * edges) and states that no separate activity feed exists yet.
 */
export function EntityDetailPanel({
  detail,
  caseId,
  incidentEdges,
  onSelectEdge,
  onOpenProfile,
  onClose,
}: EntityDetailPanelProps): JSX.Element {
  const [tab, setTab] = useState<Tab>("Overview");
  if (!detail) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4 text-sm text-[#706E68]">
        Select a node to inspect it
      </div>
    );
  }
  const visual = NODE_STYLE[detail.type];
  const tabs: Tab[] = ["Overview", "Relations", "Evidence", "Activity"];
  return (
    <div className="flex h-full w-full flex-col bg-[#1B1B19]">
      <div className="flex items-start justify-between gap-2 border-b border-[#30302D] p-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onOpenProfile(detail.id)}
            title="Open entity profile"
            className="block max-w-full truncate text-left text-sm font-semibold text-[#E8E5DD] hover:underline"
            style={{ viewTransitionName: `entity-name-${detail.id}` }}
          >
            {detail.label}
          </button>
          <span
            className="mt-1 inline-block rounded-sm border px-1.5 py-0.5 text-[11px] font-semibold"
            style={{ color: visual.color, borderColor: visual.color }}
          >
            {detail.type}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close entity panel"
          className="shrink-0 rounded-sm px-2 py-1 text-xs text-[#A5A29A] hover:bg-[#262624]"
        >
          ✕
        </button>
      </div>
      <div className="flex shrink-0 gap-1 border-b border-[#30302D] px-3 pt-2" role="tablist">
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={`rounded-t-sm px-2.5 py-1.5 text-xs font-semibold ${
              tab === name ? "bg-[#262624] text-[#E8E5DD]" : "text-[#706E68] hover:text-[#A5A29A]"
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
        {tab === "Overview" && (
          <div className="flex flex-col gap-3">
            <section>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#706E68]">
                Identifiers
              </h4>
              {detail.identifiers.length === 0 ? (
                <p className="text-[#706E68]">No identifiers recorded</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {detail.identifiers.map((identifier) => (
                    <li key={`${identifier.type}:${identifier.value}`} className="text-[#E8E5DD]">
                      <span className="mr-2 rounded-sm bg-[#262624] px-1 py-0.5 text-[11px] text-[#A5A29A]">
                        {identifier.type}
                      </span>
                      {identifier.value}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#706E68]">
                Associated cases
              </h4>
              <p className="font-mono text-[#A5A29A]">{caseId}</p>
            </section>
            <section>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#706E68]">
                Notes
              </h4>
              <button
                type="button"
                onClick={() => onOpenProfile(detail.id)}
                className="text-left text-[#A5A29A] hover:text-[#E8E5DD] hover:underline"
              >
                View and add notes in the entity profile
              </button>
            </section>
          </div>
        )}
        {tab === "Relations" && (
          <div className="flex flex-col gap-2">
            {incidentEdges.length === 0 ? (
              <p className="text-[#706E68]">No relations in the current view</p>
            ) : (
              incidentEdges.map((edge) => (
                <button
                  key={edge.id}
                  type="button"
                  onClick={() => onSelectEdge(edge.id)}
                  className="rounded-sm border border-[#30302D] bg-[#20201E] p-2 text-left hover:border-[#4A4945]"
                >
                  <span className="font-semibold text-[#E8E5DD]">{edge.type}</span>
                  <span className="ml-2 text-[#706E68]">weight {edge.weight.toFixed(2)}</span>
                </button>
              ))
            )}
          </div>
        )}
        {tab === "Evidence" && (
          <div className="flex flex-col gap-2">
            {incidentEdges.length === 0 ? (
              <p className="text-[#706E68]">No relations in the current view</p>
            ) : (
              incidentEdges.map((edge) => (
                <button
                  key={edge.id}
                  type="button"
                  onClick={() => onSelectEdge(edge.id)}
                  className="rounded-sm border border-[#30302D] bg-[#20201E] p-2 text-left hover:border-[#4A4945]"
                >
                  <span className="text-[#A5A29A]">View evidence for </span>
                  <span className="font-semibold text-[#E8E5DD]">{edge.type}</span>
                </button>
              ))
            )}
          </div>
        )}
        {tab === "Activity" && (
          <div className="flex flex-col gap-2 text-[#A5A29A]">
            <p>
              {detail.identifiers.length} identifier{detail.identifiers.length === 1 ? "" : "s"},{" "}
              {detail.aliases.length} alias{detail.aliases.length === 1 ? "" : "es"},{" "}
              {incidentEdges.length} incident relation{incidentEdges.length === 1 ? "" : "s"} in
              the current view.
            </p>
            <p className="text-[#706E68]">No separate activity feed exists yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
