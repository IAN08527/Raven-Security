import { useCallback, useEffect, useMemo, useState } from "react";
import { decideReview, fetchReviewQueue, type ReviewItem } from "../../lib/review";

// Document Review (screen 07, FR-2.7 made visible). Every field below the
// confidence threshold and every non-gated script routes here before any
// entity is created.
//
// Three panels: queue (pending, confidence ascending) | review surface
// (source crop + editable transcription + script/confidence/validator) |
// extracted-entities preview (preview only — nothing is created until
// POST /review/{id}). Rejected items stay visible as audit evidence.
// Keyboard: A accept, R reject, Tab next — shown in the UI, not hidden.
// Transitions: selection 120ms, panel slide 180ms, decision badge 180ms.

function confidenceBar(confidence: number | null): JSX.Element {
  const pct = confidence === null ? null : Math.round(confidence * 100);
  return (
    <span className="flex items-center gap-1 text-[11px] text-neutral-400">
      <span className="h-1 w-16 bg-neutral-700">
        <span className="block h-1 bg-blue-500" style={{ width: `${pct ?? 0}%` }} />
      </span>
      {pct === null ? "n/a" : `${pct}%`}
    </span>
  );
}

export function ReviewScreen({ caseId: initialCaseId }: { caseId: string }): JSX.Element {
  const [caseId, setCaseId] = useState(initialCaseId);
  const [queue, setQueue] = useState<ReviewItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [cropBroken, setCropBroken] = useState(false);

  const selected = useMemo(
    () => queue.find((item) => item.id === selectedId) ?? null,
    [queue, selectedId],
  );

  const refresh = useCallback(async () => {
    if (!caseId) {
      setQueue([]);
      return;
    }
    try {
      const rows = await fetchReviewQueue(caseId);
      setQueue(rows);
      setNote(null);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Queue unavailable.");
    }
  }, [caseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setSelectedId(null);
    setChecked(new Set());
  }, [caseId]);

  useEffect(() => {
    setText(selected?.recognised_text ?? "");
    setCropBroken(false);
  }, [selected?.id, selected?.recognised_text]);

  async function decide(
    item: ReviewItem,
    status: "corrected" | "accepted" | "rejected",
    correctedText?: string,
  ): Promise<void> {
    setBusy(true);
    try {
      await decideReview(item.id, { status, corrected_text: correctedText });
      await refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Decision failed.");
    } finally {
      setBusy(false);
    }
  }

  function accept(item: ReviewItem): void {
    const edited = text !== (item.recognised_text ?? "");
    if (edited) {
      void decide(item, "corrected", text);
    } else {
      void decide(item, "accepted", text);
    }
  }

  function next(): void {
    if (queue.length === 0) return;
    const index = queue.findIndex((item) => item.id === selectedId);
    const following = queue[(index + 1) % queue.length];
    setSelectedId(following.id);
  }

  // Keyboard shortcuts, visible in the action bar below.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!selected || busy) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
        if (event.key !== "Tab") return;
      }
      if (event.key === "a" || event.key === "A") {
        event.preventDefault();
        accept(selected);
      } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        void decide(selected, "rejected");
      } else if (event.key === "Tab") {
        event.preventDefault();
        next();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, busy, text, queue]);

  async function batch(status: "accepted" | "rejected"): Promise<void> {
    if (checked.size === 0) return;
    if (status === "rejected" && !window.confirm(`Reject ${checked.size} item(s)? Rejected items stay in the queue as audit evidence.`)) {
      return;
    }
    setBusy(true);
    try {
      for (const id of checked) {
        const item = queue.find((row) => row.id === id);
        if (item && item.status === "pending") {
          await decideReview(id, { status });
        }
      }
      setChecked(new Set());
      await refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Batch decision failed.");
    } finally {
      setBusy(false);
    }
  }

  const pending = queue.filter((item) => item.status === "pending").length;

  return (
    <div className="flex h-full flex-col gap-2 p-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl text-neutral-50">Document Review</h1>
        <span className="text-xs text-neutral-500">{pending} pending</span>
      </div>
      <label className="flex max-w-md flex-col gap-1 text-xs text-neutral-400">
        Case id
        <input
          aria-label="Review case id"
          className="border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100"
          value={caseId}
          onChange={(event) => setCaseId(event.target.value.trim())}
        />
      </label>
      {note ? <p role="alert" className="text-xs text-red-400">{note}</p> : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[240px_1fr_240px]">
        <section aria-label="Review queue" className="flex min-h-0 flex-col border border-neutral-800 bg-neutral-900">
          <div className="flex items-center justify-between border-b border-neutral-800 px-2 py-1">
            <h2 className="text-xs font-semibold text-neutral-200">Queue · worst first</h2>
            {checked.size > 0 ? (
              <span className="flex gap-1">
                <button type="button" disabled={busy} onClick={() => void batch("accepted")} className="border border-neutral-600 px-1 text-[11px] disabled:opacity-50">Accept All</button>
                <button type="button" disabled={busy} onClick={() => void batch("rejected")} className="border border-red-800 px-1 text-[11px] text-red-300 disabled:opacity-50">Reject All</button>
              </span>
            ) : null}
          </div>
          <ul className="min-h-0 flex-1 overflow-auto">
            {queue.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs transition-colors duration-[120ms] ${item.id === selectedId ? "bg-neutral-800 text-neutral-50" : "text-neutral-300 hover:bg-neutral-800/60"}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select review ${item.id}`}
                    checked={checked.has(item.id)}
                    onChange={(event) => {
                      const nextChecked = new Set(checked);
                      if (event.target.checked) nextChecked.add(item.id);
                      else nextChecked.delete(item.id);
                      setChecked(nextChecked);
                    }}
                    onClick={(event) => event.stopPropagation()}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.field_name ?? `Page ${item.page_no ?? "?"}`}</span>
                    <span className="text-[11px] text-neutral-500">{item.script} · {item.status}</span>
                  </span>
                  {confidenceBar(item.confidence)}
                </button>
              </li>
            ))}
            {queue.length === 0 ? <li className="px-2 py-2 text-xs text-neutral-500">Queue empty.</li> : null}
          </ul>
        </section>

        <section aria-label="Review surface" className="flex min-h-0 flex-col border border-neutral-800 bg-neutral-900 p-3 transition-transform duration-[180ms]">
          {!selected ? (
            <p className="text-sm text-neutral-500">Select an item from the queue.</p>
          ) : (
            <>
              {cropBroken ? (
                <div className="border border-neutral-700 bg-neutral-950 p-4 text-xs text-neutral-400">
                  Source crop unavailable at {selected.crop_path} (no crop route yet) — transcribe from the original document.
                </div>
              ) : (
                <img
                  src={selected.crop_path}
                  alt={`Source crop for review ${selected.id}`}
                  className="max-h-64 w-full border border-neutral-700 bg-neutral-950 object-contain"
                  onError={() => setCropBroken(true)}
                />
              )}
              <div className="mt-2 flex items-center gap-2 text-xs text-neutral-400">
                <span>Script: {selected.script}</span>
                {confidenceBar(selected.confidence)}
                {selected.field_name ? <span>Field: {selected.field_name}</span> : null}
              </div>
              <label className="mt-2 flex flex-1 flex-col gap-1 text-xs text-neutral-400">
                Recognised text (editable)
                <textarea
                  aria-label="Recognised text"
                  className="min-h-32 flex-1 border border-neutral-700 bg-neutral-950 p-2 text-sm text-neutral-100"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" disabled={busy} onClick={() => accept(selected)} className="border border-neutral-600 px-3 py-1 text-xs text-neutral-100 disabled:opacity-50">
                  {text !== (selected.recognised_text ?? "") ? "Correct and Accept" : "Accept"} (A)
                </button>
                <button type="button" disabled={busy} onClick={() => void decide(selected, "rejected")} className="border border-red-800 px-3 py-1 text-xs text-red-300 disabled:opacity-50">
                  Reject (R)
                </button>
                <button type="button" onClick={next} className="border border-neutral-700 px-3 py-1 text-xs text-neutral-300">
                  Next (Tab)
                </button>
              </div>
            </>
          )}
        </section>

        <section aria-label="Extracted entities preview" className="border border-neutral-800 bg-neutral-900 p-3">
          <h2 className="text-xs font-semibold text-neutral-200">Entities (preview)</h2>
          <p className="mt-2 text-xs text-neutral-500">
            Preview only — nothing is created until the decide call returns. Entity preview needs the
            extraction step; unreviewed text yields no entities (FR-2.7).
          </p>
          {selected?.status !== "pending" && selected ? (
            <p className="mt-2 border border-neutral-700 px-2 py-1 text-xs text-neutral-300 transition-colors duration-[180ms]">
              {selected.status.toUpperCase()} — kept visible as audit evidence.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
