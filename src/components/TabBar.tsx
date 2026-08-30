import { useCaseStore } from "../store/case";

export function TabBar() {
  const tabs = useCaseStore((s) => s.tabs);
  const activeTabId = useCaseStore((s) => s.activeTabId);
  const setActiveTab = useCaseStore((s) => s.setActiveTab);
  const closeTab = useCaseStore((s) => s.closeTab);
  const openTab = useCaseStore((s) => s.openTab);

  const handleNewTab = () => {
    openTab({
      id: "tab-profiles-dir",
      type: "profiles-dir",
      title: "Profiles Directory",
    });
  };

  const getTabIcon = (type: string) => {
    switch (type) {
      case "graph":
        return (
          <svg className="h-3.5 w-3.5 text-pd-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
        );
      case "profile":
        return (
          <svg className="h-3.5 w-3.5 text-pd-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        );
      case "profiles-dir":
        return (
          <svg className="h-3.5 w-3.5 text-pd-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        );
      case "vision":
        return (
          <svg className="h-3.5 w-3.5 text-pd-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        );
      case "audit":
        return (
          <svg className="h-3.5 w-3.5 text-pd-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex h-9 items-center border-b border-pd-border bg-pd-surface px-1 overflow-x-auto select-none">
      <div className="flex items-center gap-0.5">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group flex h-9 items-center gap-2 px-3 text-pd-xs transition-colors cursor-pointer border-r border-pd-border/40 ${
                isActive
                  ? "bg-pd-base text-pd-text-primary border-t-2 border-t-pd-accent font-medium shadow-inner"
                  : "bg-pd-surface text-pd-text-secondary hover:bg-pd-elevated hover:text-pd-text-primary border-t-2 border-t-transparent"
              }`}
            >
              <span className="shrink-0">{getTabIcon(tab.type)}</span>
              <span className="truncate max-w-[180px]">{tab.title}</span>

              {/* Close Button (shows on hover or when active, if >1 tab) */}
              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="rounded p-0.5 text-pd-text-tertiary hover:bg-pd-elevated hover:text-pd-danger opacity-60 group-hover:opacity-100 transition-opacity"
                  title="Close Tab"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}

        {/* New Tab Button */}
        <button
          onClick={handleNewTab}
          className="flex h-7 w-7 items-center justify-center rounded text-pd-text-tertiary hover:bg-pd-elevated hover:text-pd-text-primary ml-1 transition-colors"
          title="Open Profiles Directory"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
    </div>
  );
}
