import { useEffect, useRef, useState } from "react";
import type {
  CaseHit,
  EntityHit,
  FileHit,
  IdentifierHit,
  SearchResponse,
} from "../../types/api";
import { fetchSearch } from "../../lib/search";
import { provenanceColor } from "../../lib/provenance";

interface GlobalSearchProps {
  onOpenEntity: (entityId: string, caseId: string) => void;
  onOpenCase?: (caseId: string) => void;
  onOpenFile?: (fileId: string) => void;
}

type Tab = "All" | "People" | "Organisations" | "Documents" | "Locations" | "More";

const TABS: Tab[] = ["All", "People", "Organisations", "Documents", "Locations", "More"];

// Tab mapping (design §13 filters, adapted to the §2.12 groups). One
// `types=all` query feeds every tab — no re-query on tab switch. Known
// limitation, stated: the server caps each group at 10 before this
// split, so a crowded People tab can hide persons behind other entity
// types. Raising per-group caps is a server change, not a client one.
function tabGroups(tab: Tab, results: SearchResponse): {
  entities: EntityHit[];
  cases: CaseHit[];
  files: FileHit[];
  identifiers: IdentifierHit[];
} {
  switch (tab) {
    case "People":
      return { entities: results.entities.filter((e) => e.type === "PERSON"), cases: [], files: [], identifiers: [] };
    case "Organisations":
      return { entities: results.entities.filter((e) => e.type === "ORGANIZATION"), cases: [], files: [], identifiers: [] };
    case "Documents":
      return { entities: [], cases: [], files: results.files, identifiers: [] };
    case "Locations":
      return { entities: results.entities.filter((e) => e.type === "LOCATION"), cases: [], files: [], identifiers: [] };
    case "More":
      return {
        entities: results.entities.filter(
          (e) => e.type !== "PERSON" && e.type !== "ORGANIZATION" && e.type !== "LOCATION",
        ),
        cases: results.cases,
        files: [],
        identifiers: results.identifiers,
      };
    case "All":
    default:
      return results;
  }
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

/**
 * Screen 09. Global Search (design §13, API_CONTRACTS.md §2.12).
 * Results render only from cases the caller is assigned to — enforced
 * server-side, so this screen performs no client-side access filtering
 * of its own. Navigation callbacks are optional: rows without a host
 * screen render as plain text rather than dead buttons (design §33).
 */
export function GlobalSearch({ onOpenEntity, onOpenCase, onOpenFile }: GlobalSearchProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [caseFilter, setCaseFilter] = useState("");
  const [tab, setTab] = useState<Tab>("All");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const runRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      runRef.current += 1;
      setResults(null);
      setError(null);
      setSearching(false);
      return;
    }
    const runId = ++runRef.current;
    setSearching(true);
    const timer = setTimeout(() => {
      fetchSearch(trimmed, { caseId: caseFilter.trim() || undefined })
        .then((page) => {
          if (runId !== runRef.current) return;
          setResults(page);
          setError(null);
        })
        .catch((err: unknown) => {
          if (runId !== runRef.current) return;
          setError(err instanceof Error ? err.message : "Search unavailable.");
        })
        .finally(() => {
          if (runId === runRef.current) setSearching(false);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [query, caseFilter]);

  const groups = results ? tabGroups(tab, results) : null;
  const total = groups
    ? groups.entities.length + groups.cases.length + groups.files.length + groups.identifiers.length
    : 0;

  return (
    <div className="flex h-full w-full flex-col gap-4 p-6">
      <header>
        <h1 className="text-2xl text-neutral-50">Search</h1>
        <p className="text-sm text-neutral-400">
          Search across cases, people, organisations, locations, documents…
        </p>
      </header>
      <div className="flex max-w-2xl flex-col gap-2">
        <input
          aria-label="Global search query"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Names, aliases, case codes, filenames, phone fragments…"
          className="border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100"
        />
        <input
          aria-label="Limit to case (optional)"
          value={caseFilter}
          onChange={(event) => setCaseFilter(event.target.value.trim())}
          placeholder="Limit to case id (optional)"
          className="w-80 border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-xs text-neutral-100"
        />
      </div>

      <div className="flex shrink-0 gap-1 border-b border-neutral-800" role="tablist" aria-label="Result types">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={`rounded-t-sm px-2.5 py-1.5 text-xs font-semibold ${
              tab === name ? "bg-neutral-800 text-neutral-50" : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      <div key={tab} className="min-h-0 max-w-3xl flex-1 overflow-y-auto motion-safe:animate-fade-in">
        {error ? (
          <p role="alert" className="text-sm text-red-400">
            Search unavailable: {error}
          </p>
        ) : !query.trim() ? (
          <p className="text-sm text-neutral-500">
            Type to search entities, cases, files and identifiers across your assigned cases.
          </p>
        ) : searching && !results ? (
          <p className="text-sm text-neutral-500">Searching…</p>
        ) : !groups || total === 0 ? (
          <div className="flex flex-col gap-1 text-sm">
            <p className="text-neutral-200">No results for &ldquo;{query.trim()}&rdquo;</p>
            <p className="text-xs text-neutral-500">
              Suggestions: check spelling, switch to the All tab, or search an identifier fragment
              such as part of a phone number.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.entities.length > 0 && (
              <ResultGroup title="Entities">
                {groups.entities.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onClick={() => onOpenEntity(hit.id, hit.case_id)}
                      className="block w-full rounded-sm border border-neutral-800 bg-neutral-900 p-2 text-left transition-colors duration-[120ms] hover:border-neutral-600"
                    >
                      <span className="mr-2 text-neutral-500" aria-hidden="true">
                        ○
                      </span>
                      <span className="text-sm font-semibold text-neutral-100">{hit.canonical_name}</span>
                      <span className="ml-2 text-[11px] text-neutral-500">{hit.type}</span>
                      <ProvenanceBadge value={hit.provenance} />
                      <span className="mt-0.5 block text-[11px] text-neutral-500">
                        Case {shortId(hit.case_id)}
                      </span>
                    </button>
                  </li>
                ))}
              </ResultGroup>
            )}
            {groups.cases.length > 0 && (
              <ResultGroup title="Cases">
                {groups.cases.map((hit) =>
                  onOpenCase ? (
                    <li key={hit.id}>
                      <button
                        type="button"
                        onClick={() => onOpenCase(hit.id)}
                        className="block w-full rounded-sm border border-neutral-800 bg-neutral-900 p-2 text-left transition-colors duration-[120ms] hover:border-neutral-600"
                      >
                        <CaseRow hit={hit} />
                      </button>
                    </li>
                  ) : (
                    <li
                      key={hit.id}
                      className="rounded-sm border border-neutral-800 bg-neutral-900 p-2"
                    >
                      <CaseRow hit={hit} />
                    </li>
                  ),
                )}
              </ResultGroup>
            )}
            {groups.files.length > 0 && (
              <ResultGroup title="Documents">
                {groups.files.map((hit) =>
                  onOpenFile ? (
                    <li key={hit.id}>
                      <button
                        type="button"
                        onClick={() => onOpenFile(hit.id)}
                        className="block w-full rounded-sm border border-neutral-800 bg-neutral-900 p-2 text-left transition-colors duration-[120ms] hover:border-neutral-600"
                      >
                        <FileRow hit={hit} />
                      </button>
                    </li>
                  ) : (
                    <li
                      key={hit.id}
                      className="rounded-sm border border-neutral-800 bg-neutral-900 p-2"
                    >
                      <FileRow hit={hit} />
                    </li>
                  ),
                )}
              </ResultGroup>
            )}
            {groups.identifiers.length > 0 && (
              <ResultGroup title="Identifiers">
                {groups.identifiers.map((hit, index) => (
                  <li key={`${hit.entity_id}:${hit.value}:${index}`}>
                    <button
                      type="button"
                      onClick={() => onOpenEntity(hit.entity_id, hit.case_id)}
                      className="block w-full rounded-sm border border-neutral-800 bg-neutral-900 p-2 text-left transition-colors duration-[120ms] hover:border-neutral-600"
                    >
                      <span className="mr-2 text-neutral-500" aria-hidden="true">
                        #
                      </span>
                      <span className="font-mono text-sm text-neutral-100">{hit.value}</span>
                      <ProvenanceBadge value={hit.provenance} />
                      <span className="mt-0.5 block text-[11px] text-neutral-500">
                        Entity {shortId(hit.entity_id)} · Case {shortId(hit.case_id)}
                      </span>
                    </button>
                  </li>
                ))}
              </ResultGroup>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultGroup({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function ProvenanceBadge({ value }: { value: string }): JSX.Element {
  return (
    <span
      className="ml-2 rounded-sm border px-1.5 py-0.5 text-[11px]"
      style={{ color: provenanceColor(value), borderColor: provenanceColor(value) }}
      title="Data provenance (D19)"
    >
      {value}
    </span>
  );
}

function CaseRow({ hit }: { hit: CaseHit }): JSX.Element {
  return (
    <>
      <span className="mr-2 text-neutral-500" aria-hidden="true">
        ▤
      </span>
      <span className="font-mono text-sm font-semibold text-neutral-100">{hit.case_code}</span>
      <span className="mt-0.5 block text-xs text-neutral-400">{hit.title}</span>
    </>
  );
}

function FileRow({ hit }: { hit: FileHit }): JSX.Element {
  return (
    <>
      <span className="mr-2 text-neutral-500" aria-hidden="true">
        ▦
      </span>
      <span className="text-sm font-semibold text-neutral-100">{hit.name}</span>
      <ProvenanceBadge value={hit.provenance} />
      <span className="mt-0.5 block text-[11px] text-neutral-500">Case {shortId(hit.case_id)}</span>
    </>
  );
}
