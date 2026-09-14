import type { EdgeEvidenceItem, GraphEdge } from "../../types/api";

export interface DateRange {
  from: string; // YYYY-MM-DD, inclusive, UTC; empty means unbounded
  to: string; // YYYY-MM-DD, inclusive, UTC; empty means unbounded
}

function inRange(occurredAt: string | null, range: DateRange): boolean {
  if (!occurredAt) return true; // undated evidence is never hidden by the date filter
  const day = occurredAt.slice(0, 10);
  if (range.from && day < range.from) return false;
  if (range.to && day > range.to) return false;
  return true;
}

interface EdgeEvidencePanelProps {
  edge: GraphEdge | null;
  items: EdgeEvidenceItem[];
  loading: boolean;
  dateRange: DateRange;
  onClose: () => void;
}

/**
 * M4-T5, FR-4.4/FR-4.6. Evidence for the selected edge, fetched through
 * the separate `GET /edges/{id}/evidence` call -- opening this panel
 * never re-queries or re-lays-out the graph. Tampered rows use red AND
 * an explicit TAMPERED label plus both hashes (design §3.3: never color
 * alone; FR-7.2: both hashes shown). Date-filtered rows are counted,
 * not silently dropped.
 */
export function EdgeEvidencePanel({
  edge,
  items,
  loading,
  dateRange,
  onClose,
}: EdgeEvidencePanelProps): JSX.Element {
  if (!edge) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4 text-sm text-[#706E68]">
        Select an edge to inspect its evidence
      </div>
    );
  }
  const visible = items.filter((item) => inRange(item.occurred_at, dateRange));
  const hidden = items.length - visible.length;
  return (
    <div className="flex h-full w-full flex-col bg-[#1B1B19]">
      <div className="flex items-start justify-between gap-2 border-b border-[#30302D] p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#E8E5DD]">{edge.type}</p>
          <p className="mt-0.5 text-[11px] text-[#706E68]">
            weight {edge.weight.toFixed(2)} · {items.length} evidence item{items.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close evidence panel"
          className="shrink-0 rounded-sm px-2 py-1 text-xs text-[#A5A29A] hover:bg-[#262624]"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? (
          <p className="text-xs text-[#706E68]">Loading evidence…</p>
        ) : visible.length === 0 ? (
          <p className="text-xs text-[#706E68]">
            {items.length === 0 ? "No evidence recorded for this edge" : "All items outside the date range"}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((item) => (
              <li
                key={item.id}
                className={`rounded-sm border bg-[#20201E] p-2 ${
                  item.tamper_state === "tampered" ? "border-[#D8665C]" : "border-[#30302D]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#E8E5DD]">{item.kind}</span>
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
                {item.snippet && <p className="mt-1 text-xs text-[#A5A29A]">{item.snippet}</p>}
                <p className="mt-1 font-mono text-[11px] text-[#706E68]">
                  {item.source_file_id.slice(0, 8)}
                  {item.page_no !== null ? ` · p.${item.page_no}` : ""}
                  {item.char_start !== null && item.char_end !== null
                    ? ` · chars ${item.char_start}–${item.char_end}`
                    : ""}
                  {` · ${item.provenance}`}
                </p>
                {item.tamper_state === "tampered" && (
                  <div className="mt-1 font-mono text-[11px] text-[#D8665C]">
                    <p>ledger: {item.ledger_hash ?? "missing"}</p>
                    <p>computed: {item.computed_hash ?? "missing"}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 && (
          <p className="mt-2 text-[11px] text-[#706E68]">
            {hidden} item{hidden === 1 ? "" : "s"} hidden by the date filter
          </p>
        )}
      </div>
    </div>
  );
}
