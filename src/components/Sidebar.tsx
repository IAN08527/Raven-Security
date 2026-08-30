import { useCaseStore } from "../store/case";

const items = [
  { id: "graph", label: "Criminal Net", icon: "graph" },
  { id: "map", label: "Routine Map", icon: "map" },
  { id: "vision", label: "CCTV Vision", icon: "camera" },
  { id: "audit", label: "Audit Ledger", icon: "shield" },
] as const;

export function Sidebar() {
  const activeView = useCaseStore((s) => s.activeView);
  const setView = useCaseStore((s) => s.setView);

  return (
    <nav className="flex w-60 flex-col border-r border-pd-border bg-pd-surface py-2">
      <div className="px-3 py-1 text-pd-xs uppercase tracking-wider text-pd-text-tertiary">
        Workspace
      </div>
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => setView(it.id as never)}
          className={`flex h-7 items-center gap-2 px-3 text-pd-base ${
            activeView === it.id
              ? "border-l-2 border-pd-accent bg-pd-accent/15 text-pd-accent"
              : "border-l-2 border-transparent text-pd-text-secondary hover:bg-pd-elevated"
          }`}
        >
          <span className="text-pd-text-tertiary">{it.icon}</span>
          {it.label}
        </button>
      ))}
    </nav>
  );
}
