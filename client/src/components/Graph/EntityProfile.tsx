import { useEffect, useRef, useState } from "react";
import type {
  EdgeEvidenceItem,
  EntityListItem,
  EntityRecord,
  GraphEdge,
  GraphNode,
} from "../../types/api";
import { fetchAuditRows, verifyAuditRow, type AuditRow, type VerifyResult } from "../../lib/audit";
import { fetchEdgeEvidence, fetchEgoGraph } from "../../lib/graphApi";
import {
  fetchEntities,
  fetchEntityRecord,
  postEntityNote,
  proposeMerge,
} from "../../lib/entities";
import { fetchFile } from "../../lib/files";
import { provenanceColor } from "../../lib/provenance";
import { getSession } from "../../lib/session";
import { NODE_STYLE } from "./NetworkGraph";

interface EntityProfileProps {
  entityId: string;
  caseId: string;
  onBack: () => void;
  onOpenEntity: (entityId: string) => void;
  onOpenCase?: (caseId: string) => void;
  onOpenFile?: (fileId: string, page: number | null) => void;
}

type Tab = "Overview" | "Relations" | "Evidence" | "Activity";

type RelationSort = "weight" | "evidence" | "type";

type TamperFilter = "all" | "verified" | "pending" | "tampered";

const ALL_TYPES = ["PERSON", "ORGANIZATION", "LOCATION", "VEHICLE", "ACCOUNT"] as const;

function connection(): { base: string; token: string } {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const session = getSession();
  if (!session) {
    throw new Error("not signed in");
  }
  return {
    base: (env?.VITE_SERVER_URL ?? "https://localhost:8443").replace(/\/$/, ""),
    token: session.token,
  };
}

function truncateSnippet(snippet: string): string {
  return snippet.length > 120 ? `${snippet.slice(0, 120)}…` : snippet;
}

function inDateRange(occurredAt: string | null, from: string, to: string): boolean {
  if (!occurredAt) return true; // undated evidence is never hidden by the date filter
  const day = occurredAt.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

/**
 * Screen 08. Entity Profile (design §14): header, four tabs, quick
 * actions — every value from a real endpoint, honest empty states
 * elsewhere (design §29, rule 10).
 *
 * Deliberately absent, with reasons:
 * - No risk score badge or sort: PRD §5 excludes risk scoring of
 *   individuals (API_CONTRACTS.md §2.5). Relations sort by edge weight,
 *   evidence count, or relationship type instead.
 * - No Active / Under Watch / Cleared status: no lifecycle exists in
 *   any doc, so there is nothing truthful to display.
 * - No date of birth / nationality: neither is held by the entities
 *   endpoints (nationality is not in the schema at all).
 * - No Aadhaar/PAN-specific treatment or masking: the identifier model
 *   carries PHONE / VEHICLE / ACCOUNT / IMEI / NAFIS with no masking
 *   policy documented, so identifiers render as stored, type + value.
 * - No confidence on evidence rows: the evidence contract carries no
 *   confidence field.
 */
export function EntityProfile({
  entityId,
  caseId,
  onBack,
  onOpenEntity,
  onOpenCase,
  onOpenFile,
}: EntityProfileProps): JSX.Element {
  const [tab, setTab] = useState<Tab>("Overview");
  const [record, setRecord] = useState<EntityRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [egoNodes, setEgoNodes] = useState<GraphNode[]>([]);
  const [egoEdges, setEgoEdges] = useState<GraphEdge[]>([]);
  const [relationsError, setRelationsError] = useState<string | null>(null);
  const [sort, setSort] = useState<RelationSort>("weight");
  const [evidenceByEdge, setEvidenceByEdge] = useState<Record<string, EdgeEvidenceItem[]>>({});
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [kindFilter, setKindFilter] = useState("all");
  const [tamperFilter, setTamperFilter] = useState<TamperFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [verifications, setVerifications] = useState<Record<string, VerifyResult>>({});
  const [noteText, setNoteText] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkResults, setLinkResults] = useState<EntityListItem[]>([]);
  const [linkTarget, setLinkTarget] = useState("");
  const [linkReason, setLinkReason] = useState("");
  const [linkState, setLinkState] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const noteBoxRef = useRef<HTMLTextAreaElement>(null);
  // Monotonic run id shared by every data effect below. Setting state
  // mid-flight (the evidence effect merges edge rows, then resolves file
  // names) schedules a re-render whose cleanup flips that run's
  // `cancelled` flag while its awaits are still pending — so `cancelled`
  // alone cannot tell a superseded run from a live one. Any entity change
  // bumps the id (detail effect); each effect captures its own id after
  // its guards and discards its results when the id has moved on. A
  // stale run merging another entity's rows would be a correctness bug
  // in this tool, not a flicker.
  const dataRunRef = useRef(0);

  const session = getSession();
  const canAnnotate = session?.role === "io";

  useEffect(() => {
    let cancelled = false;
    dataRunRef.current += 1;
    setRecord(null);
    setLoadError(null);
    setTab("Overview");
    setEgoNodes([]);
    setEgoEdges([]);
    setEvidenceByEdge({});
    setFileNames({});
    setAuditRows([]);
    setLinkState(null);
    setLinkOpen(false);
    async function load(): Promise<void> {
      try {
        const detail = await fetchEntityRecord(entityId);
        if (!cancelled) setRecord(detail);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Entity unavailable.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  useEffect(() => {
    if (tab !== "Relations" && tab !== "Evidence") return;
    if (egoEdges.length > 0 || relationsError) return;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const { base, token } = connection();
        // Contract default is person-only (D23); the Relations tab shows
        // all types explicitly rather than relying on the default.
        const payload = await fetchEgoGraph(base, token, caseId, entityId, {
          hops: 1,
          types: [...ALL_TYPES],
        });
        if (cancelled) return;
        setEgoNodes(payload.nodes);
        setEgoEdges(payload.edges);
      } catch (err) {
        if (!cancelled) setRelationsError(err instanceof Error ? err.message : "Relations unavailable.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [tab, caseId, entityId, egoEdges.length, relationsError]);

  // Evidence backs both the Relations tab (per-relation counts and
  // count sorting) and the Evidence tab (rows). Missing edges are
  // fetched once and merged; the effect goes quiet when nothing is
  // missing so setting state does not re-trigger it.
  useEffect(() => {
    if (tab !== "Relations" && tab !== "Evidence") return;
    const missing = egoEdges.filter((edge) => !(edge.id in evidenceByEdge));
    if (missing.length === 0) return;
    // Run id only — deliberately not the `cancelled` flag below. Our own
    // mid-flight setState re-renders (and runs this effect's cleanup)
    // while the file-name fetch is still pending; consulting `cancelled`
    // here would discard our own results. Supersession is detected by
    // the id: tab/entity changes bump it (detail effect, or a new run
    // below). Unmounted setState is a safe no-op in React 18.
    const runId = ++dataRunRef.current;
    const live = (): boolean => runId === dataRunRef.current;
    async function load(): Promise<void> {
      try {
        const { base, token } = connection();
        const entries = await Promise.all(
          missing.map(async (edge) => {
            const items = await fetchEdgeEvidence(base, token, edge.id);
            return [edge.id, items] as const;
          }),
        );
        if (!live()) return;
        const fileIds = new Set<string>();
        for (const [, items] of entries) {
          for (const item of items) fileIds.add(item.source_file_id);
        }
        setEvidenceByEdge((prev) => {
          const next = { ...prev };
          for (const [edgeId, items] of entries) next[edgeId] = items;
          return next;
        });
        const names: Record<string, string> = {};
        await Promise.all(
          [...fileIds].map(async (fileId) => {
            try {
              const detail = await fetchFile(fileId);
              names[fileId] = detail.file.name;
            } catch {
              // Fall back to the id prefix below; a missing file record
              // must not fail the whole evidence tab.
            }
          }),
        );
        if (live() && Object.keys(names).length > 0) {
          setFileNames((prev) => ({ ...prev, ...names }));
        }
      } catch (err) {
        if (live()) setEvidenceError(err instanceof Error ? err.message : "Evidence unavailable.");
      }
    }
    void load();
  }, [tab, egoEdges, evidenceByEdge]);

  useEffect(() => {
    if (tab !== "Activity") return;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const rows = await fetchAuditRows(caseId, {});
        if (!cancelled) setAuditRows(rows.filter((row) => row.object_id === entityId));
      } catch (err) {
        if (!cancelled) setActivityError(err instanceof Error ? err.message : "Activity unavailable.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [tab, caseId, entityId]);

  async function saveNote(): Promise<void> {
    const text = noteText.trim();
    if (!text) {
      setNoteError("Note text must be non-empty.");
      return;
    }
    setNoteSaving(true);
    setNoteError(null);
    try {
      await postEntityNote(entityId, text);
      setNoteText("");
      setRecord(await fetchEntityRecord(entityId));
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "Note was not saved.");
    } finally {
      setNoteSaving(false);
    }
  }

  async function searchLinkTargets(): Promise<void> {
    setLinkState(null);
    try {
      const page = await fetchEntities(caseId, { search: linkSearch, limit: 10 });
      setLinkResults(page.results.filter((item) => item.id !== entityId));
    } catch (err) {
      setLinkState(err instanceof Error ? err.message : "Search unavailable.");
    }
  }

  async function proposeLink(): Promise<void> {
    if (!linkTarget || !linkReason.trim()) {
      setLinkState("Pick a target entity and give a reason.");
      return;
    }
    try {
      const result = await proposeMerge(entityId, linkTarget, linkReason.trim());
      setLinkState(`Merge proposed (id ${result.merge_id}, status ${result.status}). A person must confirm it before anything changes.`);
    } catch (err) {
      setLinkState(err instanceof Error ? err.message : "Proposal failed.");
    }
  }

  async function verifyRow(row: AuditRow): Promise<void> {
    try {
      const result = await verifyAuditRow(caseId, row.id);
      setVerifications((prev) => ({ ...prev, [row.id]: result }));
    } catch {
      setVerifications((prev) => ({
        ...prev,
        [row.id]: {
          row_id: row.id,
          object_id: row.object_id,
          stored_hash: row.payload_hash,
          ledger_hash: null,
          tampered: false,
          endorsements: [],
          ledger_tx_id: null,
        },
      }));
    }
  }

  if (loadError) {
    return (
      <div className="flex h-full w-full flex-col gap-2 p-6 text-sm">
        <p className="text-[#E8E5DD]">Entity unavailable: {loadError}</p>
        <button
          type="button"
          onClick={onBack}
          className="w-fit rounded-sm bg-[#262624] px-3 py-1 text-xs font-semibold text-[#A5A29A]"
        >
          ← Back
        </button>
      </div>
    );
  }
  if (!record) {
    return <p className="p-6 text-sm text-[#706E68]">Loading entity…</p>;
  }

  const visual = NODE_STYLE[record.type];
  const nodeById = new Map(egoNodes.map((node) => [node.id, node]));
  const evidenceCount = (edgeId: string): number => evidenceByEdge[edgeId]?.length ?? 0;
  const sortedEdges = [...egoEdges].sort((a, b) => {
    if (sort === "weight") return b.weight - a.weight;
    if (sort === "evidence") return evidenceCount(b.id) - evidenceCount(a.id);
    return a.type.localeCompare(b.type);
  });
  const allEvidence = egoEdges.flatMap((edge) =>
    (evidenceByEdge[edge.id] ?? []).map((item) => ({ edge, item })),
  );
  const kinds = [...new Set(allEvidence.map(({ item }) => item.kind))].sort();
  const visibleEvidence = allEvidence.filter(
    ({ item }) =>
      (kindFilter === "all" || item.kind === kindFilter) &&
      (tamperFilter === "all" || item.tamper_state === tamperFilter) &&
      inDateRange(item.occurred_at, dateFrom, dateTo),
  );
  const tabs: Tab[] = ["Overview", "Relations", "Evidence", "Activity"];

  return (
    <div className="flex h-full w-full flex-col bg-[#151514]">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#30302D] p-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-sm bg-[#262624] px-3 py-1 text-xs font-semibold text-[#A5A29A]"
        >
          ← Back
        </button>
        <div className="min-w-0">
          <h1
            className="truncate text-2xl font-semibold text-[#E8E5DD]"
            style={{ viewTransitionName: `entity-name-${record.id}` }}
          >
            {record.canonical_name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className="rounded-sm border px-2 py-0.5 text-xs font-semibold"
              style={{ color: visual.color, borderColor: visual.color }}
            >
              {record.type}
            </span>
            <span
              className="rounded-sm border px-2 py-0.5 text-xs"
              style={{ color: provenanceColor(record.provenance), borderColor: provenanceColor(record.provenance) }}
              title="Data provenance (D19)"
            >
              {record.provenance}
            </span>
            <span className="text-[11px] text-[#706E68]">sync: {record.sync_state}</span>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {canAnnotate && (
            <button
              type="button"
              onClick={() => {
                setTab("Overview");
                requestAnimationFrame(() => noteBoxRef.current?.focus());
              }}
              className="rounded-sm border border-[#30302D] px-2 py-1 text-xs text-[#A5A29A] hover:text-[#E8E5DD]"
            >
              Add Note
            </button>
          )}
          {canAnnotate && (
            <button
              type="button"
              onClick={() => setLinkOpen((open) => !open)}
              aria-expanded={linkOpen}
              className="rounded-sm border border-[#30302D] px-2 py-1 text-xs text-[#A5A29A] hover:text-[#E8E5DD]"
            >
              Create Link
            </button>
          )}
          {onOpenCase && (
            <button
              type="button"
              onClick={() => onOpenCase(caseId)}
              className="rounded-sm border border-[#30302D] px-2 py-1 text-xs text-[#A5A29A] hover:text-[#E8E5DD]"
            >
              View in Case
            </button>
          )}
        </div>
      </div>

      {linkOpen && canAnnotate && (
        <div className="shrink-0 border-b border-[#30302D] bg-[#1B1B19] p-3 text-xs">
          <p className="text-[#A5A29A]">
            Propose a merge with another entity in this case. A proposal changes nothing — a person
            must confirm it (rule 1).
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              aria-label="Link target search"
              value={linkSearch}
              onChange={(event) => setLinkSearch(event.target.value)}
              placeholder="Search entities by name or alias"
              className="w-64 border border-[#30302D] bg-[#171716] px-2 py-1 text-[#E8E5DD]"
            />
            <button
              type="button"
              onClick={() => void searchLinkTargets()}
              className="rounded-sm bg-[#262624] px-2 py-1 font-semibold text-[#A5A29A]"
            >
              Search
            </button>
          </div>
          {linkResults.length > 0 && (
            <ul className="mt-2 flex max-w-xl flex-col gap-1">
              {linkResults.map((item) => (
                <li key={item.id}>
                  <label className="flex cursor-pointer items-center gap-2 text-[#E8E5DD]">
                    <input
                      type="radio"
                      name="link-target"
                      checked={linkTarget === item.id}
                      onChange={() => setLinkTarget(item.id)}
                    />
                    {item.canonical_name}
                    <span className="text-[11px] text-[#706E68]">{item.type}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              aria-label="Link reason"
              value={linkReason}
              onChange={(event) => setLinkReason(event.target.value)}
              placeholder="Reason (e.g. shared identifier plus normalised name)"
              className="w-96 border border-[#30302D] bg-[#171716] px-2 py-1 text-[#E8E5DD]"
            />
            <button
              type="button"
              onClick={() => void proposeLink()}
              className="rounded-sm bg-[#262624] px-2 py-1 font-semibold text-[#A5A29A]"
            >
              Propose merge
            </button>
          </div>
          {linkState && <p className="mt-2 text-[#A5A29A]">{linkState}</p>}
        </div>
      )}

      <div className="flex shrink-0 gap-1 border-b border-[#30302D] px-4 pt-2" role="tablist">
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

      <div key={tab} className="min-h-0 flex-1 overflow-y-auto p-4 text-xs motion-safe:animate-fade-in">
        {tab === "Overview" && (
          <div className="grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2">
            <section className="rounded-sm border border-[#30302D] bg-[#1B1B19] p-3">
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#706E68]">
                Identity
              </h2>
              <p className="text-sm text-[#E8E5DD]">{record.canonical_name}</p>
              <h3 className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-[#706E68]">
                Also known as
              </h3>
              {record.aliases.length === 0 ? (
                <p className="text-[#706E68]">No aliases recorded</p>
              ) : (
                <ul className="flex flex-col gap-1 text-[#E8E5DD]">
                  {record.aliases.map((alias) => (
                    <li key={alias}>{alias}</li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rounded-sm border border-[#30302D] bg-[#1B1B19] p-3">
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#706E68]">
                Identifiers
              </h2>
              {record.identifiers.length === 0 ? (
                <p className="text-[#706E68]">No identifiers recorded</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {record.identifiers.map((identifier) => (
                    <li key={identifier} className="font-mono text-[#E8E5DD]">
                      {identifier}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rounded-sm border border-[#30302D] bg-[#1B1B19] p-3">
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#706E68]">
                Associated cases
              </h2>
              <ul className="flex flex-col gap-1">
                {record.associated_cases.map((id) => (
                  <li key={id} className="font-mono text-[#A5A29A]">
                    {id}
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-sm border border-[#30302D] bg-[#1B1B19] p-3">
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#706E68]">
                Notes
              </h2>
              {record.notes.length === 0 ? (
                <p className="text-[#706E68]">No notes recorded</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {record.notes.map((note) => (
                    <li key={note.id} className="border-l-2 border-[#30302D] pl-2">
                      <p className="text-[#E8E5DD]">{note.text}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-[#706E68]">
                        {note.created_by.slice(0, 8)} · {note.created_at.slice(0, 10)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {canAnnotate ? (
                <div className="mt-3 flex flex-col gap-2">
                  <textarea
                    ref={noteBoxRef}
                    aria-label="New note"
                    value={noteText}
                    onChange={(event) => setNoteText(event.target.value)}
                    rows={2}
                    maxLength={2000}
                    placeholder="Add an attributed annotation…"
                    className="border border-[#30302D] bg-[#171716] px-2 py-1 text-[#E8E5DD]"
                  />
                  <button
                    type="button"
                    disabled={noteSaving}
                    onClick={() => void saveNote()}
                    className="w-fit rounded-sm bg-[#262624] px-2 py-1 font-semibold text-[#A5A29A] disabled:opacity-50"
                  >
                    {noteSaving ? "Saving…" : "Save note"}
                  </button>
                  {noteError && (
                    <p role="alert" className="text-[#D8665C]">
                      {noteError}
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-[#706E68]">Annotation requires the investigating-officer role.</p>
              )}
            </section>
          </div>
        )}

        {tab === "Relations" && (
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2">
              <label htmlFor="relation-sort" className="text-[#706E68]">
                Sort by
              </label>
              <select
                id="relation-sort"
                value={sort}
                onChange={(event) => setSort(event.target.value as RelationSort)}
                className="border border-[#30302D] bg-[#171716] px-2 py-1 text-[#E8E5DD]"
              >
                <option value="weight">Edge weight (highest first)</option>
                <option value="evidence">Evidence count (highest first)</option>
                <option value="type">Relationship type</option>
              </select>
            </div>
            {relationsError ? (
              <p role="alert" className="text-[#D8665C]">
                Relations unavailable: {relationsError}
              </p>
            ) : sortedEdges.length === 0 ? (
              <p className="text-[#706E68]">No relations recorded for this entity</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {sortedEdges.map((edge) => {
                  const otherId = edge.src === entityId ? edge.dst : edge.src;
                  const other = nodeById.get(otherId);
                  return (
                    <li key={edge.id}>
                      <button
                        type="button"
                        onClick={() => onOpenEntity(otherId)}
                        className="w-full rounded-sm border border-[#30302D] bg-[#20201E] p-2 text-left transition-colors duration-[120ms] hover:border-[#4A4945]"
                      >
                        <span className="font-semibold text-[#E8E5DD]">{other?.label ?? otherId}</span>
                        <span className="ml-2 text-[#706E68]">
                          {edge.type} · weight {edge.weight.toFixed(2)} ·{" "}
                          {evidenceCount(edge.id)} evidence
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {tab === "Evidence" && (
          <div className="max-w-4xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label htmlFor="evidence-kind" className="text-[#706E68]">
                Kind
              </label>
              <select
                id="evidence-kind"
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value)}
                className="border border-[#30302D] bg-[#171716] px-2 py-1 text-[#E8E5DD]"
              >
                <option value="all">All kinds</option>
                {kinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
              <label htmlFor="evidence-tamper" className="text-[#706E68]">
                Tamper
              </label>
              <select
                id="evidence-tamper"
                value={tamperFilter}
                onChange={(event) => setTamperFilter(event.target.value as TamperFilter)}
                className="border border-[#30302D] bg-[#171716] px-2 py-1 text-[#E8E5DD]"
              >
                <option value="all">All states</option>
                <option value="verified">Verified</option>
                <option value="pending">Pending</option>
                <option value="tampered">Tampered</option>
              </select>
              <label htmlFor="evidence-from" className="text-[#706E68]">
                From
              </label>
              <input
                id="evidence-from"
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="border border-[#30302D] bg-[#171716] px-2 py-1 text-[#E8E5DD]"
              />
              <label htmlFor="evidence-to" className="text-[#706E68]">
                To
              </label>
              <input
                id="evidence-to"
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="border border-[#30302D] bg-[#171716] px-2 py-1 text-[#E8E5DD]"
              />
            </div>
            {evidenceError ? (
              <p role="alert" className="text-[#D8665C]">
                Evidence unavailable: {evidenceError}
              </p>
            ) : visibleEvidence.length === 0 ? (
              <p className="text-[#706E68]">
                {allEvidence.length === 0
                  ? "No evidence recorded for this entity"
                  : "No evidence matches the current filters"}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {visibleEvidence.map(({ edge, item }) => {
                  const body = (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#E8E5DD]">{item.kind}</span>
                        {item.tamper_state === "tampered" ? (
                          <span className="rounded-sm border border-[#D8665C] bg-[#2A1512] px-1.5 py-0.5 text-[11px] font-bold text-[#D8665C]">
                            TAMPERED
                          </span>
                        ) : (
                          <span className="rounded-sm bg-[#262624] px-1.5 py-0.5 text-[11px] text-[#A5A29A]">
                            {item.tamper_state}
                          </span>
                        )}
                      </div>
                      {item.snippet && (
                        <p className="mt-1 text-[#A5A29A]">{truncateSnippet(item.snippet)}</p>
                      )}
                      <p className="mt-1 font-mono text-[11px] text-[#706E68]">
                        {fileNames[item.source_file_id] ?? item.source_file_id.slice(0, 8)}
                        {item.page_no !== null ? ` · p.${item.page_no}` : ""}
                        {item.occurred_at ? ` · ${item.occurred_at.slice(0, 10)}` : ""}
                        {` · ${item.provenance}`}
                      </p>
                      {item.tamper_state === "tampered" && (
                        <p className="mt-1 font-mono text-[11px] text-[#D8665C]">
                          stored {item.computed_hash ?? "—"} · anchored {item.ledger_hash ?? "—"}
                        </p>
                      )}
                      <p className="mt-0.5 text-[11px] text-[#50504B]">
                        via {edge.type} · weight {edge.weight.toFixed(2)}
                      </p>
                    </>
                  );
                  return (
                    <li
                      key={`${edge.id}:${item.id}`}
                      className={`rounded-sm border bg-[#20201E] p-2 transition-colors duration-[180ms] ${
                        item.tamper_state === "tampered"
                          ? "border-l-4 border-l-[#D8665C] border-[#D8665C]"
                          : "border-[#30302D]"
                      }`}
                    >
                      {onOpenFile ? (
                        <button
                          type="button"
                          onClick={() => onOpenFile(item.source_file_id, item.page_no)}
                          className="block w-full text-left"
                        >
                          {body}
                        </button>
                      ) : (
                        <div>{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {tab === "Activity" && (
          <div className="max-w-3xl">
            {activityError ? (
              <p role="alert" className="text-[#D8665C]">
                Activity unavailable: {activityError}
              </p>
            ) : auditRows.length === 0 ? (
              <p className="text-[#706E68]">No recorded actions reference this entity</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {auditRows.map((row) => {
                  const verification = verifications[row.id];
                  return (
                    <li key={row.id} className="rounded-sm border border-[#30302D] bg-[#20201E] p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-[#E8E5DD]">
                          {row.action.replace(/\./g, " · ")}
                        </span>
                        <button
                          type="button"
                          onClick={() => void verifyRow(row)}
                          className="rounded-sm bg-[#262624] px-2 py-0.5 text-[11px] text-[#A5A29A]"
                        >
                          Verify
                        </button>
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-[#706E68]">
                        {row.created_at.slice(0, 19).replace("T", " ")}Z · {row.user_role} ·
                        {row.user_id.slice(0, 8)} · tx {row.ledger_tx_id ?? "—"}
                      </p>
                      {verification && (
                        <p className="mt-1 font-mono text-[11px] text-[#A5A29A]">
                          stored {verification.stored_hash.slice(0, 16)}… · anchored{" "}
                          {verification.ledger_hash ? `${verification.ledger_hash.slice(0, 16)}…` : "—"}
                          {verification.tampered ? (
                            <span className="ml-2 font-bold text-[#D8665C]">TAMPERED</span>
                          ) : null}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Navigate with a shared-element transition where supported, plain
 *  switch otherwise. The 180ms name transition pairs the
 *  `viewTransitionName` on the entity heading here with the matching
 *  name on the detail panel; this helper only decides whether the
 *  browser animates the document change. */
export function navigateWithTransition(apply: () => void): void {
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => void;
  };
  if (typeof doc.startViewTransition === "function") {
    doc.startViewTransition(apply);
  } else {
    apply();
  }
}
