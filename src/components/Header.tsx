import { useCaseStore } from "../store/case";

interface HeaderProps {
  onHealth: () => void;
}

export function Header({ onHealth }: HeaderProps) {
  const setCommandPaletteOpen = useCaseStore((s) => s.setCommandPaletteOpen);
  const openTab = useCaseStore((s) => s.openTab);

  return (
    <header className="flex h-7 items-center justify-between border-b border-pd-border bg-pd-base px-3 text-pd-sm select-none">
      {/* Brand & Menu */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 font-bold tracking-tight text-pd-accent">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="text-pd-base">RAVEN</span>
        </div>

        <nav className="flex items-center gap-3 text-pd-text-secondary text-pd-xs">
          <button
            onClick={() => openTab({ id: "tab-profiles-dir", type: "profiles-dir", title: "Profiles Directory" })}
            className="hover:text-pd-text-primary transition-colors"
          >
            File
          </button>
          <button
            onClick={() => setCommandPaletteOpen(true)}
            className="hover:text-pd-text-primary transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => openTab({ id: "tab-graph", type: "graph", title: "Macro Network" })}
            className="hover:text-pd-text-primary transition-colors"
          >
            View
          </button>
          <button
            onClick={() => openTab({ id: "tab-cctv", type: "vision", title: "CCTV Live Monitor - Cam 01" })}
            className="hover:text-pd-text-primary transition-colors"
          >
            Tools
          </button>
          <button
            onClick={() => openTab({ id: "tab-logs", type: "audit", title: "Audit Ledger" })}
            className="hover:text-pd-text-primary transition-colors"
          >
            Help
          </button>
        </nav>
      </div>

      {/* Global Search Bar (Ctrl+K trigger) */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex h-5 w-60 items-center justify-between rounded-sm border border-pd-border bg-pd-surface px-2 text-pd-xs text-pd-text-tertiary hover:border-pd-accent/60 hover:text-pd-text-secondary transition-colors"
        >
          <span className="flex items-center gap-1.5 truncate">
            <svg className="h-3 w-3 text-pd-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="truncate">Search suspects, cases, actions...</span>
          </span>
          <kbd className="font-mono text-[9px] bg-pd-elevated px-1 py-0.5 rounded text-pd-text-tertiary border border-pd-border">
            Ctrl+K
          </kbd>
        </button>

        {/* Health Probe Trigger */}
        <button
          onClick={onHealth}
          className="flex items-center gap-1 text-[11px] text-pd-text-secondary hover:text-pd-text-primary px-1.5 py-0.5 rounded hover:bg-pd-surface transition-colors"
        >
          <span className="h-2 w-2 rounded-full bg-pd-success animate-pulse" />
          Health
        </button>

        {/* User Badge */}
        <div className="flex items-center gap-1.5 pl-1 border-l border-pd-border/60">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-pd-accent/20 text-[10px] font-bold text-pd-accent">
            IO
          </div>
          <span className="text-[11px] text-pd-text-secondary font-medium">A. Kumar</span>
        </div>
      </div>
    </header>
  );
}
