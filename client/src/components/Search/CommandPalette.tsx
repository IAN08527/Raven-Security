import { useEffect, useRef, useState } from "react";
import { fetchSearch } from "../../lib/search";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenEntity: (entityId: string, caseId: string) => void;
  onOpenCase?: (caseId: string) => void;
  onOpenFile?: (fileId: string) => void;
}

interface PaletteItem {
  key: string;
  label: string;
  sub: string;
  run: () => void;
}

// Recent searches live in module memory only: they survive palette
// open/close within the tab and vanish with it. Never localStorage —
// a persisted query log outlives the operator's presence at the
// workstation (session.ts documents the same stance for tokens).
const recentSearches: string[] = [];
const MAX_RECENTS = 8;

function addRecent(query: string): void {
  const trimmed = query.trim();
  if (!trimmed) return;
  const at = recentSearches.indexOf(trimmed);
  if (at >= 0) recentSearches.splice(at, 1);
  recentSearches.unshift(trimmed);
  if (recentSearches.length > MAX_RECENTS) recentSearches.length = MAX_RECENTS;
}

/**
 * Ctrl+K command palette (design §13): the same GET /search endpoint as
 * the Search screen, top 5 results across all types. Arrow keys move,
 * Enter selects, Esc closes. Case/file rows without a host screen are
 * omitted here rather than shown dead — the palette is for jumping, so
 * a row that goes nowhere does not belong in it.
 */
export function CommandPalette({
  open,
  onClose,
  onOpenEntity,
  onOpenCase,
  onOpenFile,
}: CommandPaletteProps): JSX.Element | null {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PaletteItem[]>([]);
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const runRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setItems([]);
    setActive(0);
    setRecents([...recentSearches]);
  }, [open ]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!open || !trimmed) {
      runRef.current += 1;
      setItems([]);
      setActive(0);
      return;
    }
    const runId = ++runRef.current;
    const timer = setTimeout(() => {
      fetchSearch(trimmed, { limit: 5 })
        .then((page) => {
          if (runId !== runRef.current) return;
          const found: PaletteItem[] = [];
          for (const hit of page.entities) {
            found.push({
              key: `entity:${hit.id}`,
              label: hit.canonical_name,
              sub: `${hit.type} · ${hit.case_id.slice(0, 8)}`,
              run: () => onOpenEntity(hit.id, hit.case_id),
            });
          }
          if (onOpenCase) {
            for (const hit of page.cases) {
              found.push({
                key: `case:${hit.id}`,
                label: `${hit.case_code} — ${hit.title}`,
                sub: "Case",
                run: () => onOpenCase(hit.id),
              });
            }
          }
          if (onOpenFile) {
            for (const hit of page.files) {
              found.push({
                key: `file:${hit.id}`,
                label: hit.name,
                sub: "Document",
                run: () => onOpenFile(hit.id),
              });
            }
          }
          for (const hit of page.identifiers) {
            found.push({
              key: `identifier:${hit.entity_id}:${hit.value}`,
              label: hit.value,
              sub: `Identifier · ${hit.entity_id.slice(0, 8)}`,
              run: () => onOpenEntity(hit.entity_id, hit.case_id),
            });
          }
          setItems(found.slice(0, 5));
          setActive(0);
        })
        .catch(() => {
          if (runId === runRef.current) {
            setItems([]);
            setActive(0);
          }
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open, onOpenEntity, onOpenCase, onOpenFile]);

  if (!open) return null;

  function choose(index: number): void {
    const item = items[index];
    if (!item) return;
    addRecent(query);
    onClose();
    item.run();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-24"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl rounded-sm border border-neutral-700 bg-neutral-900 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          aria-label="Command palette search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, items.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(active);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          placeholder="Search people, cases, documents…"
          className="w-full border-b border-neutral-700 bg-transparent px-4 py-3 text-neutral-100 outline-none"
        />
        {query.trim() ? (
          <ul className="max-h-64 overflow-y-auto p-2">
            {items.length === 0 ? (
              <li className="px-3 py-2 text-sm text-neutral-500">No matches</li>
            ) : (
              items.map((item, index) => (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => choose(index)}
                    onMouseEnter={() => setActive(index)}
                    className={`block w-full rounded-sm px-3 py-2 text-left ${
                      index === active ? "bg-neutral-800" : ""
                    }`}
                  >
                    <span className="text-sm text-neutral-100">{item.label}</span>
                    <span className="ml-2 text-xs text-neutral-500">{item.sub}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : recents.length > 0 ? (
          <ul className="max-h-64 overflow-y-auto p-2" aria-label="Recent searches">
            {recents.map((recent) => (
              <li key={recent}>
                <button
                  type="button"
                  onClick={() => setQuery(recent)}
                  className="block w-full rounded-sm px-3 py-2 text-left text-sm text-neutral-400 hover:bg-neutral-800"
                >
                  {recent}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-neutral-500">
            Type to search across your assigned cases. ↑↓ to move, Enter to open, Esc to close.
          </p>
        )}
      </div>
    </div>
  );
}
