import { useEffect, useRef, useState } from "react";
import type { JsonValue, TimelineEvent } from "../../types/api";
import { fetchCaseTimeline, timelineToCsv } from "../../lib/timeline";

function asRecord(detail: JsonValue): Record<string, JsonValue> {
  // Timeline `detail` is arbitrary JSON (JsonValue); evidence events
  // carry an object. Non-object details read as empty, never crash.
  if (typeof detail === "object" && detail !== null && !Array.isArray(detail)) {
    return detail as Record<string, JsonValue>;
  }
  return {};
}

interface TimelineScreenProps {
  caseId: string;
  onOpenEntity: (entityId: string) => void;
}

const EVENT_TYPES = ["file_ingested", "evidence_committed", "candidate_proposed", "audit_action"] as const;

// Event-type colors (design §3.2 accents). Fixed mapping, stated here.
const EVENT_COLOR: Record<string, string> = {
  file_ingested: "#668DBA",
  evidence_committed: "#4FAE79",
  candidate_proposed: "#8273A8",
  audit_action: "#706E68",
};

const EVENT_ICON: Record<string, string> = {
  file_ingested: "▦",
  evidence_committed: "◈",
  candidate_proposed: "◎",
  audit_action: "✎",
};

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Screen 11. Case Timeline (design §16, API_CONTRACTS.md §2.10).
 * Every event carries its clock label — CASE TIME for case-clock
 * analysis time, SYSTEM TIME for infrastructure wall-clock (D16).
 * Tampered evidence renders red with a TAMPERED label plus both hashes
 * (design §34: never color alone). CSV export is generated client-side
 * from the filtered events; there is no server export route.
 */
export function TimelineScreen({ caseId, onOpenEntity }: TimelineScreenProps): JSX.Element {
  const [typeFilter, setTypeFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ascending, setAscending] = useState(false);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runRef = useRef(0);

  useEffect(() => {
    const runId = ++runRef.current;
    setLoading(true);
    setError(null);
    fetchCaseTimeline(caseId, {
      type: typeFilter || undefined,
      entityId: entityFilter.trim() || undefined,
      from: dateFrom ? `${dateFrom}T00:00:00Z` : undefined,
      to: dateTo ? `${dateTo}T23:59:59Z` : undefined,
      order: ascending ? "asc" : undefined,
    })
      .then((page) => {
        if (runId !== runRef.current) return;
        setEvents(page.results);
        setCursor(page.next_cursor);
      })
      .catch((err: unknown) => {
        if (runId === runRef.current) {
          setEvents([]);
          setError(err instanceof Error ? err.message : "Timeline unavailable.");
        }
      })
      .finally(() => {
        if (runId === runRef.current) setLoading(false);
      });
  }, [caseId, typeFilter, entityFilter, dateFrom, dateTo, ascending]);

  async function loadMore(): Promise<void> {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchCaseTimeline(caseId, {
        type: typeFilter || undefined,
        entityId: entityFilter.trim() || undefined,
        from: dateFrom ? `${dateFrom}T00:00:00Z` : undefined,
        to: dateTo ? `${dateTo}T23:59:59Z` : undefined,
        order: ascending ? "asc" : undefined,
        cursor,
      });
      setEvents((prev) => [...prev, ...page.results]);
      setCursor(page.next_cursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load more events.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl text-neutral-50">Case Timeline</h1>
          <p className="text-sm text-neutral-400">
            Every event in chronological order. CASE TIME is case-clock analysis time; SYSTEM TIME
            is infrastructure wall-clock.
          </p>
        </div>
        <button
          type="button"
          onClick={() => timelineToCsv(caseId, events)}
          disabled={events.length === 0}
          className="rounded-sm border border-neutral-700 px-2 py-1 text-xs text-neutral-200 disabled:opacity-50"
        >
          Export CSV
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label htmlFor="timeline-type" className="text-neutral-500">
          Type
        </label>
        <select
          id="timeline-type"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          className="border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
        >
          <option value="">All event types</option>
          {EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <label htmlFor="timeline-entity" className="text-neutral-500">
          Entity
        </label>
        <input
          id="timeline-entity"
          value={entityFilter}
          onChange={(event) => setEntityFilter(event.target.value.trim())}
          placeholder="Entity id"
          className="w-72 border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-neutral-100"
        />
        <label htmlFor="timeline-from" className="text-neutral-500">
          From
        </label>
        <input
          id="timeline-from"
          type="date"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
          className="border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
        />
        <label htmlFor="timeline-to" className="text-neutral-500">
          To
        </label>
        <input
          id="timeline-to"
          type="date"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
          className="border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
        />
        <button
          type="button"
          onClick={() => setAscending((value) => !value)}
          className="rounded-sm border border-neutral-700 px-2 py-1 text-neutral-200"
        >
          {ascending ? "Oldest first" : "Newest first"}
        </button>
      </div>

      <div className="min-h-0 max-w-3xl flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-sm text-neutral-500">Loading timeline…</p>
        ) : error ? (
          <p role="alert" className="text-sm text-red-400">
            Timeline unavailable: {error}
          </p>
        ) : events.length === 0 ? (
          <p className="text-sm text-neutral-500">No events match the current filters.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {events.map((event, index) => {
              const detail = asRecord(event.detail);
              const tampered =
                event.event_type === "evidence_committed" && detail["tamper_state"] === "tampered";
              const ledgerHash = asText(detail["ledger_hash"]);
              const computedHash = asText(detail["computed_hash"]);
              return (
                <li
                  key={`${event.ts}:${event.event_type}:${index}`}
                  className={`rounded-sm border bg-neutral-900 p-3 ${
                    tampered ? "border-l-4 border-l-red-500 border-red-500" : "border-neutral-800"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span aria-hidden="true" style={{ color: EVENT_COLOR[event.event_type] ?? "#706E68" }}>
                      {EVENT_ICON[event.event_type] ?? "•"}
                    </span>
                    <span className="text-sm font-semibold text-neutral-100">
                      {event.description}
                    </span>
                    {tampered && (
                      <span className="rounded-sm border border-red-500 bg-red-950 px-1.5 py-0.5 text-[11px] font-bold text-red-400">
                        TAMPERED
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-neutral-500">
                    {event.ts} ·{" "}
                    <span className="font-bold text-neutral-300">
                      {event.clock === "case" ? "CASE TIME" : "SYSTEM TIME"}
                    </span>
                    {event.actor ? ` · ${event.actor.slice(0, 8)}` : ""}
                  </p>
                  {tampered && (
                    <p className="mt-1 font-mono text-[11px] text-red-400">
                      stored {computedHash ?? "—"} · anchored {ledgerHash ?? "—"}
                    </p>
                  )}
                  {event.entity_refs.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {event.entity_refs.map((ref) => (
                        <button
                          key={ref}
                          type="button"
                          title={ref}
                          onClick={() => onOpenEntity(ref)}
                          className="rounded-sm bg-neutral-800 px-1.5 py-0.5 font-mono text-[11px] text-neutral-300 hover:text-neutral-50"
                        >
                          {ref.slice(0, 8)}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {!loading && !error && cursor && (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            className="mt-3 rounded-sm border border-neutral-700 px-3 py-1 text-xs text-neutral-200 disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}
