import { useState } from "react";
import { useCaseStore, WorkspaceTab } from "../store/case";

interface BrowserHeaderProps {
  onHealth: () => void;
}

export function BrowserHeader({ onHealth }: BrowserHeaderProps) {
  const tabs = useCaseStore((s) => s.tabs);
  const activeTabId = useCaseStore((s) => s.activeTabId);
  const setActiveTab = useCaseStore((s) => s.setActiveTab);
  const closeTab = useCaseStore((s) => s.closeTab);
  const openTab = useCaseStore((s) => s.openTab);
  const navigateBack = useCaseStore((s) => s.navigateBack);
  const navigateForward = useCaseStore((s) => s.navigateForward);
  const historyIndex = useCaseStore((s) => s.historyIndex);
  const tabHistory = useCaseStore((s) => s.tabHistory);
  const caseId = useCaseStore((s) => s.caseId);
  const isSidebarCollapsed = useCaseStore((s) => s.isSidebarCollapsed);
  const toggleSidebar = useCaseStore((s) => s.toggleSidebar);
  const setIngestModalOpen = useCaseStore((s) => s.setIngestModalOpen);
  const setCommandPaletteOpen = useCaseStore((s) => s.setCommandPaletteOpen);

  const [showNewTabMenu, setShowNewTabMenu] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

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
      case "document":
        return (
          <svg className="h-3.5 w-3.5 text-pd-danger" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        );
      case "databases":
        return (
          <svg className="h-3.5 w-3.5 text-pd-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7c0 1.657 3.582 3 8 3s8-1.343 8-3-3.582-3-8-3-8 1.343-8 3z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v5c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 12v5c0 1.657 3.582 3 8 3s8-1.343 8-3v-5" />
          </svg>
        );
      default:
        return (
          <svg className="h-3.5 w-3.5 text-pd-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        );
    }
  };

  const getOmnibarUrl = () => {
    if (!activeTab) return "raven://op-raven-01/workspace";
    if (activeTab.url) return activeTab.url;
    const cleanTitle = activeTab.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    return `raven://${caseId.toLowerCase()}/${activeTab.type}/${cleanTitle}`;
  };

  return (
    <header className="flex flex-col border-b border-pd-border bg-pd-base select-none">
      {/* 1. Top Browser Tab Strip */}
      <div className="flex h-10 items-center bg-[#090d13] px-2 gap-1 overflow-x-auto">
        {/* Sidebar Toggle & App Icon */}
        <div className="flex items-center gap-2 pr-2 border-r border-pd-border/40 shrink-0">
          <button
            onClick={toggleSidebar}
            className="flex h-7 w-7 items-center justify-center rounded text-pd-text-secondary hover:bg-pd-surface hover:text-pd-accent transition-colors"
            title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          </button>

          <div className="flex items-center gap-1.5 font-bold tracking-wider text-pd-accent text-pd-xs">
            <svg className="h-4 w-4 text-pd-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="font-mono">RAVEN</span>
          </div>
        </div>

        {/* Browser Tabs */}
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`group relative flex h-8 items-center gap-2 rounded-t-md px-3 text-pd-xs transition-all cursor-pointer border-t-2 border-x ${
                  isActive
                    ? "bg-pd-base text-pd-text-primary border-t-pd-accent border-x-pd-border font-semibold shadow-sm"
                    : "bg-[#111620] text-pd-text-secondary hover:bg-pd-surface hover:text-pd-text-primary border-t-transparent border-x-transparent"
                }`}
                style={{ maxWidth: "220px", minWidth: "120px" }}
              >
                <span className="shrink-0">{getTabIcon(tab.type)}</span>
                <span className="truncate flex-1 text-left font-medium">{tab.title}</span>

                {/* Tab Close Button */}
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="rounded p-0.5 text-pd-text-tertiary hover:bg-pd-elevated hover:text-pd-danger opacity-0 group-hover:opacity-100 transition-opacity"
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
          <div className="relative">
            <button
              onClick={() => setShowNewTabMenu(!showNewTabMenu)}
              className="flex h-7 w-7 items-center justify-center rounded text-pd-text-tertiary hover:bg-pd-elevated hover:text-pd-text-primary transition-colors"
              title="Open New Tab"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>

            {showNewTabMenu && (
              <div className="absolute left-0 top-8 z-50 w-52 rounded-md border border-pd-border bg-pd-surface p-1 shadow-xl text-pd-xs">
                <button
                  onClick={() => {
                    openTab({ id: "tab-graph", type: "graph", title: "Macro Network", url: "raven://op-raven-01/graph" });
                    setShowNewTabMenu(false);
                  }}
                  className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-pd-text-secondary hover:bg-pd-elevated hover:text-pd-text-primary"
                >
                  <span className="text-pd-accent">🕸️</span> Macro Graph
                </button>
                <button
                  onClick={() => {
                    openTab({ id: "tab-profiles-dir", type: "profiles-dir", title: "Profiles Directory", url: "raven://op-raven-01/profiles" });
                    setShowNewTabMenu(false);
                  }}
                  className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-pd-text-secondary hover:bg-pd-elevated hover:text-pd-text-primary"
                >
                  <span className="text-pd-accent">👥</span> Suspect Profiles
                </button>
                <button
                  onClick={() => {
                    openTab({ id: "tab-databases", type: "databases", title: "Data Sources & Ingest", url: "raven://op-raven-01/data-sources" });
                    setShowNewTabMenu(false);
                  }}
                  className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-pd-text-secondary hover:bg-pd-elevated hover:text-pd-text-primary"
                >
                  <span className="text-pd-accent">📁</span> Ingest & Databases
                </button>
                <button
                  onClick={() => {
                    openTab({ id: "tab-cctv", type: "vision", title: "CCTV Live Monitor - Cam 01", url: "raven://op-raven-01/vision" });
                    setShowNewTabMenu(false);
                  }}
                  className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-pd-text-secondary hover:bg-pd-elevated hover:text-pd-text-primary"
                >
                  <span className="text-pd-warning">📹</span> CCTV Vision
                </button>
                <button
                  onClick={() => {
                    openTab({ id: "tab-logs", type: "audit", title: "Audit Ledger", url: "raven://op-raven-01/audit" });
                    setShowNewTabMenu(false);
                  }}
                  className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-pd-text-secondary hover:bg-pd-elevated hover:text-pd-text-primary"
                >
                  <span className="text-pd-success">🛡️</span> Audit Ledger
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Quick Officer Badge */}
        <div className="flex items-center gap-2 pl-2 text-pd-xs shrink-0">
          <button
            onClick={() => setIngestModalOpen(true)}
            className="flex items-center gap-1.5 rounded bg-pd-accent/15 border border-pd-accent/30 px-2.5 py-1 font-semibold text-pd-accent hover:bg-pd-accent hover:text-pd-base transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>+ Ingest Data</span>
          </button>
        </div>
      </div>

      {/* 2. Browser Navigation & Omnibar (Address Bar) */}
      <div className="flex h-9 items-center justify-between gap-3 bg-pd-base px-3 border-t border-pd-border/40">
        {/* Navigation Buttons */}
        <div className="flex items-center gap-1 text-pd-text-secondary">
          <button
            onClick={navigateBack}
            disabled={historyIndex <= 0}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-pd-surface hover:text-pd-text-primary disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Back"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <button
            onClick={navigateForward}
            disabled={historyIndex >= tabHistory.length - 1}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-pd-surface hover:text-pd-text-primary disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            title="Forward"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <button
            onClick={() => window.location.reload()}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-pd-surface hover:text-pd-text-primary transition-colors"
            title="Reload View"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Omnibar / Address Bar */}
        <div
          onClick={() => setCommandPaletteOpen(true)}
          className="group flex h-6 flex-1 items-center justify-between rounded border border-pd-border bg-pd-surface px-2.5 text-pd-xs text-pd-text-secondary cursor-pointer hover:border-pd-accent/60 hover:bg-pd-elevated transition-all"
        >
          <div className="flex items-center gap-2 truncate">
            <span className="text-pd-success text-[10px] flex items-center gap-1 font-mono">
              <svg className="h-3 w-3 text-pd-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </span>
            <span className="font-mono text-pd-text-primary text-[11px] truncate">
              {getOmnibarUrl()}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-pd-text-tertiary">
            <span className="text-[10px] hidden md:inline">Press Ctrl+K to jump</span>
            <kbd className="font-mono text-[9px] bg-pd-base px-1 py-0.5 rounded border border-pd-border">
              Ctrl+K
            </kbd>
          </div>
        </div>

        {/* Right Tools: Health & Profile */}
        <div className="flex items-center gap-2">
          <button
            onClick={onHealth}
            className="flex items-center gap-1.5 rounded px-2 py-0.5 text-pd-xs text-pd-text-secondary hover:bg-pd-surface hover:text-pd-text-primary transition-colors font-mono"
          >
            <span className="h-2 w-2 rounded-full bg-pd-success animate-pulse" />
            <span className="text-[11px]">SERVICES LIVE</span>
          </button>

          <div className="flex items-center gap-1.5 pl-2 border-l border-pd-border/60">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-pd-accent/20 text-[10px] font-bold text-pd-accent">
              IO
            </div>
            <span className="text-[11px] text-pd-text-secondary font-medium hidden sm:inline">
              IO A. Kumar
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
