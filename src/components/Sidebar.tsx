import { useCaseStore } from "../store/case";

const navItems = [
  {
    id: "profiles",
    label: "Profiles",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
    badge: "24",
  },
  {
    id: "graph",
    label: "Graph",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
      </svg>
    ),
    badge: "Live",
  },
  {
    id: "cctv",
    label: "CCTV",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
    badge: "4 Cams",
  },
  {
    id: "logs",
    label: "Logs",
    icon: (
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    badge: "Audit",
  },
] as const;

export function Sidebar() {
  const activeNav = useCaseStore((s) => s.activeNav);
  const setActiveNav = useCaseStore((s) => s.setActiveNav);
  const caseId = useCaseStore((s) => s.caseId);

  return (
    <aside className="flex w-60 flex-col border-r border-pd-border bg-pd-base py-3 select-none">
      {/* Case Section Header */}
      <div className="px-3 pb-3 border-b border-pd-border/60">
        <div className="flex items-center justify-between">
          <span className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">
            Active Case
          </span>
          <span className="flex items-center gap-1 text-pd-xs text-pd-success">
            <span className="h-1.5 w-1.5 rounded-full bg-pd-success animate-pulse" />
            Live
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 rounded bg-pd-surface px-2.5 py-1.5 border border-pd-border">
          <svg className="h-4 w-4 text-pd-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-pd-base font-semibold text-pd-text-primary">
              {caseId}
            </div>
            <div className="text-[10px] text-pd-text-tertiary truncate">
              MHA/NCRB Syndicate Taskforce
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Items (The 4 Core Items) */}
      <div className="flex-1 px-2 pt-3 space-y-1">
        <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-pd-text-tertiary">
          Modules
        </div>

        {navItems.map((item) => {
          const isActive = activeNav === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`group flex w-full h-8 items-center gap-2.5 rounded-sm px-2.5 text-pd-base transition-colors ${
                isActive
                  ? "border-l-2 border-pd-accent bg-pd-accent/10 font-medium text-pd-accent shadow-sm"
                  : "border-l-2 border-transparent text-pd-text-secondary hover:bg-pd-surface hover:text-pd-text-primary"
              }`}
            >
              <span className={`shrink-0 ${isActive ? "text-pd-accent" : "text-pd-text-tertiary group-hover:text-pd-text-secondary"}`}>
                {item.icon}
              </span>
              <span className="flex-1 text-left truncate">{item.label}</span>
              {item.badge && (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    isActive
                      ? "bg-pd-accent/20 text-pd-accent"
                      : "bg-pd-surface text-pd-text-tertiary border border-pd-border/60"
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer System Status */}
      <div className="px-3 pt-2 border-t border-pd-border/60 text-pd-xs text-pd-text-tertiary flex items-center justify-between">
        <span>VRAM 4.2/8.0 GB</span>
        <span className="font-mono text-[10px]">Tauri v2</span>
      </div>
    </aside>
  );
}
