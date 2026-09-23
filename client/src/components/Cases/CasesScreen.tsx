import { useEffect, useState } from "react";
import type { CaseHit, CaseRecord } from "../../types/api";
import { createCase, listCases } from "../../lib/cases";
import { fetchSearch } from "../../lib/search";
import type { AppRole } from "../../lib/roles";

// Case Management (reference: bottom-left tile, design §8, contract
// §2.1). Assigned cases list live via GET /v1/cases; search runs the
// real GET /v1/search endpoint. Nothing is invented (rule 10):
// statuses need no column because the record carries none.

export function CasesScreen({
  role,
  onOpenCaseId,
}: {
  role: AppRole;
  onOpenCaseId: (caseId: string, target: "map" | "timeline" | "audit" | "graph") => void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CaseHit[]>([]);
  const [assigned, setAssigned] = useState<CaseRecord[]>([]);
  const [listNote, setListNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [manualId, setManualId] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [createNote, setCreateNote] = useState<string | null>(null);

  async function refreshAssigned(): Promise<void> {
    try {
      setAssigned(await listCases());
      setListNote(null);
    } catch (err) {
      setAssigned([]);
      setListNote(err instanceof Error ? err.message : "Case list unavailable.");
    }
  }

  useEffect(() => {
    void refreshAssigned();
  }, []);

  async function search(): Promise<void> {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const page = await fetchSearch(q, { types: "cases" });
      setResults(page.cases);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search unavailable.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 bg-[#151514] p-6 text-[#E8E5DD]">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl text-[#E8E5DD]">Case Management</h1>
          <p className="text-sm text-[#A5A29A]">Track, investigate and manage cases.</p>
        </div>
      </header>

      {role === "admin" ? (
        <section aria-label="Open a case" className="flex flex-wrap items-end gap-2 border border-[#30302D] bg-[#1B1B19] p-3">
          <label className="flex flex-col gap-1 text-[11px] text-[#A5A29A]">
            Case code
            <input
              aria-label="New case code"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="CR-2026-017"
              className="w-40 border border-[#30302D] bg-[#171716] px-2 py-1 font-mono text-xs text-[#E8E5DD]"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-[#A5A29A]">
            Title
            <input
              aria-label="New case title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Mumbai Theft Ring"
              className="w-64 border border-[#30302D] bg-[#171716] px-2 py-1 text-xs text-[#E8E5DD]"
            />
          </label>
          <button
            type="button"
            disabled={!newCode.trim() || !newTitle.trim()}
            onClick={() => {
              setCreateNote(null);
              void createCase({ case_code: newCode.trim(), title: newTitle.trim() })
                .then(() => {
                  setNewCode("");
                  setNewTitle("");
                  return refreshAssigned();
                })
                .catch((err: unknown) =>
                  setCreateNote(err instanceof Error ? err.message : "Case was not created."),
                );
            }}
            className="border border-[#30302D] bg-[#262624] px-3 py-1 text-sm text-[#E8E5DD] disabled:opacity-50"
          >
            + New Case
          </button>
          {createNote ? (
            <p role="alert" className="w-full text-xs text-[#D8665C]">
              {createNote}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="flex gap-2">
        <input
          aria-label="Search cases"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search();
          }}
          placeholder="Search cases…"
          className="w-80 border border-[#30302D] bg-[#171716] px-2 py-1 text-sm text-[#E8E5DD] placeholder:text-[#706E68]"
        />
        <button
          type="button"
          onClick={() => void search()}
          className="border border-[#30302D] bg-[#262624] px-3 py-1 text-sm text-[#E8E5DD]"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-[#D8665C]">
          {error}
        </p>
      ) : null}

      <section aria-label="Assigned cases" className="border border-[#30302D] bg-[#1B1B19]">
        <h2 className="border-b border-[#30302D] px-3 py-2 text-xs font-semibold text-[#E8E5DD]">
          My cases
        </h2>
        {listNote ? (
          <p role="alert" className="px-3 py-2 text-xs text-[#D8665C]">
            {listNote}
          </p>
        ) : null}
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[#30302D] text-[#A5A29A]">
              <th className="px-3 py-2">Case code</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Open</th>
            </tr>
          </thead>
          <tbody>
            {assigned.map((row) => (
              <tr key={row.id} className="border-b border-[#272724] hover:bg-[#20201E]">
                <td className="px-3 py-2 font-mono text-[#E8E5DD]">{row.case_code}</td>
                <td className="px-3 py-2 text-[#A5A29A]">{row.title}</td>
                <td className="px-3 py-2">
                  <span className="flex gap-1">
                    {(["graph", "map", "timeline", "audit"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onOpenCaseId(row.id, t)}
                        className="border border-[#30302D] px-1.5 py-0.5 text-[11px] text-[#A5A29A] hover:text-[#E8E5DD]"
                      >
                        {t}
                      </button>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {assigned.length === 0 && !listNote ? (
          <p className="px-3 py-3 text-xs text-[#706E68]">
            No assigned cases. An administrator opens cases and assigns them to you.
          </p>
        ) : null}
      </section>

      <section aria-label="Search results" className="border border-[#30302D] bg-[#1B1B19]">
        <h2 className="border-b border-[#30302D] px-3 py-2 text-xs font-semibold text-[#E8E5DD]">
          Search all assigned cases
        </h2>
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[#30302D] text-[#A5A29A]">
              <th className="px-3 py-2">Case code</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Open</th>
            </tr>
          </thead>
          <tbody>
            {results.map((hit) => (
              <tr key={hit.id} className="border-b border-[#272724] hover:bg-[#20201E]">
                <td className="px-3 py-2 font-mono text-[#E8E5DD]">{hit.case_code}</td>
                <td className="px-3 py-2 text-[#A5A29A]">{hit.title}</td>
                <td className="px-3 py-2">
                  <span className="flex gap-1">
                    {(["graph", "map", "timeline", "audit"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onOpenCaseId(hit.id, t)}
                        className="border border-[#30302D] px-1.5 py-0.5 text-[11px] text-[#A5A29A] hover:text-[#E8E5DD]"
                      >
                        {t}
                      </button>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {results.length === 0 && !searching ? (
          <p className="px-3 py-3 text-xs text-[#706E68]">
            No rows. Search by case code or title above — results come only from your assigned
            cases.
          </p>
        ) : null}
      </section>

      <section aria-label="Open by id" className="flex items-end gap-2 text-xs text-[#A5A29A]">
        <label className="flex flex-col gap-1">
          Open case id directly
          <input
            aria-label="Manual case id"
            value={manualId}
            onChange={(e) => setManualId(e.target.value.trim())}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="w-80 border border-[#30302D] bg-[#171716] px-2 py-1 font-mono text-[#E8E5DD]"
          />
        </label>
        {(["graph", "map", "timeline", "audit"] as const).map((t) => (
          <button
            key={t}
            type="button"
            disabled={!manualId}
            onClick={() => onOpenCaseId(manualId, t)}
            className="border border-[#30302D] px-2 py-1 text-[#E8E5DD] disabled:opacity-50"
          >
            Open {t}
          </button>
        ))}
      </section>
    </div>
  );
}
