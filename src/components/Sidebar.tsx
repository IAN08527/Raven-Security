import { useState } from "react";
import { useCaseStore, WorkspaceTab } from "../store/case";

export function Sidebar({ onOpenHealth }: { onOpenHealth?: () => void }) {
  const tabs = useCaseStore((s) => s.tabs);
  const activeTabId = useCaseStore((s) => s.activeTabId);
  const setActiveTab = useCaseStore((s) => s.setActiveTab);
  const closeTab = useCaseStore((s) => s.closeTab);
  const openTab = useCaseStore((s) => s.openTab);
  const caseId = useCaseStore((s) => s.caseId);
  const isSidebarCollapsed = useCaseStore((s) => s.isSidebarCollapsed);
  const toggleSidebar = useCaseStore((s) => s.toggleSidebar);
  const setIngestModalOpen = useCaseStore((s) => s.setIngestModalOpen);
  const setCommandPaletteOpen = useCaseStore((s) => s.setCommandPaletteOpen);

  // Collapsible subsection state
  const [openSections, setOpenSections] = useState({
    tabs: true,
    intelligence: true,
    surveillance: true,
    data: true,
    targets: true,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
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

  const quickSuspects = [
    { id: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332", name: "Rakesh Sawant", role: "Syndicate Leader", risk: 94 },
    { id: "8c35e396-4191-5369-9c5c-7ec65df27d5e", name: "Vikram Patel", role: "Hawala Operator", risk: 87 },
    { id: "5761aefc-da70-5883-999a-00e998a4d468", name: "Mohd. Khan", role: "Weapons & Logistics", risk: 82 },
  ];

  return (
    <aside
      className={`flex h-full flex-col border-r border-pd-border bg-[#0b0e14] transition-all duration-200 select-none z-20 shrink-0 ${
        isSidebarCollapsed ? "w-16" : "w-72"
      }`}
    >
      {/* 1. Brand & Case Banner */}
      <div className="border-b border-pd-border/60 p-3 bg-[#080b0f]">
        {!isSidebarCollapsed ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-pd-accent/15 border border-pd-accent/30 text-pd-accent shadow-sm">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <div className="font-mono text-pd-sm font-bold tracking-wider text-pd-accent">
                    RAVEN OS
                  </div>
                  <div className="text-[10px] text-pd-text-tertiary">Intelligence Platform</div>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIngestModalOpen(true)}
                  className="flex h-6 items-center gap-1 rounded bg-pd-accent/15 border border-pd-accent/30 px-2 text-[10px] font-mono font-bold text-pd-accent hover:bg-pd-accent hover:text-pd-base transition-colors"
                  title="Upload / Ingest File"
                >
                  <span>+ INGEST</span>
                </button>
                <button
                  onClick={toggleSidebar}
                  className="rounded p-1 text-pd-text-tertiary hover:bg-pd-surface hover:text-pd-text-primary transition-colors"
                  title="Collapse Sidebar"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Case Info Badge */}
            <div className="rounded-md bg-pd-surface p-2 border border-pd-border/70 shadow-inner flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-mono text-pd-xs font-bold text-pd-text-primary truncate">
                  <span>{caseId}</span>
                  <span className="flex h-1.5 w-1.5 rounded-full bg-pd-success animate-pulse" />
                </div>
                <div className="text-[10px] text-pd-text-secondary truncate">
                  MHA Syndicate Taskforce
                </div>
              </div>
              <button
                onClick={() => setCommandPaletteOpen(true)}
                className="rounded px-1.5 py-0.5 bg-pd-elevated border border-pd-border font-mono text-[9px] text-pd-text-tertiary hover:text-pd-text-primary"
                title="Search Command Palette (Ctrl+K)"
              >
                Ctrl+K
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={toggleSidebar}
              className="flex h-8 w-8 items-center justify-center rounded bg-pd-accent/15 border border-pd-accent/30 text-pd-accent hover:bg-pd-accent hover:text-pd-base transition-colors"
              title="Expand Sidebar"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </button>
            <button
              onClick={() => setIngestModalOpen(true)}
              className="rounded p-1 text-pd-accent hover:bg-pd-surface transition-colors"
              title="Upload / Ingest Data"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* 2. Scrollable Sidebar Navigation & Subsections */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {/* SUBSECTION: 📑 OPEN TABS (Vertical Tabs) */}
        {!isSidebarCollapsed ? (
          <div className="space-y-1">
            <div
              onClick={() => toggleSection("tabs")}
              className="flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-pd-text-tertiary hover:text-pd-text-primary cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <span className="text-[9px]">{openSections.tabs ? "▼" : "▶"}</span>
                <span>Open Tabs ({tabs.length})</span>
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openTab({ id: "tab-graph", type: "graph", title: "Macro Network" });
                }}
                className="rounded p-0.5 hover:bg-pd-surface hover:text-pd-accent transition-colors"
                title="New Tab"
              >
                +
              </button>
            </div>

            {openSections.tabs && (
              <div className="space-y-1 pl-1">
                {tabs.map((tab) => {
                  const isActive = tab.id === activeTabId;
                  return (
                    <div
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`group flex items-center justify-between rounded-md px-2.5 py-1.5 text-pd-xs transition-all cursor-pointer border ${
                        isActive
                          ? "bg-pd-accent/15 border-pd-accent/40 text-pd-accent font-semibold shadow-sm"
                          : "bg-pd-surface/40 border-transparent text-pd-text-secondary hover:bg-pd-surface hover:text-pd-text-primary"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="shrink-0">{getTabIcon(tab.type)}</span>
                        <span className="truncate text-[12px]">{tab.title}</span>
                      </div>

                      {tabs.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTab(tab.id);
                          }}
                          className="rounded p-0.5 text-pd-text-tertiary hover:bg-pd-elevated hover:text-pd-danger opacity-0 group-hover:opacity-100 transition-opacity ml-1"
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
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex h-9 w-full items-center justify-center rounded-md transition-colors ${
                  tab.id === activeTabId ? "bg-pd-accent/20 text-pd-accent" : "text-pd-text-tertiary hover:bg-pd-surface"
                }`}
                title={tab.title}
              >
                {getTabIcon(tab.type)}
              </button>
            ))}
          </div>
        )}

        {/* SUBSECTION: 🕸️ INTELLIGENCE & LINK ANALYSIS */}
        <div className="space-y-1">
          {!isSidebarCollapsed ? (
            <div
              onClick={() => toggleSection("intelligence")}
              className="flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-pd-text-tertiary hover:text-pd-text-primary cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <span className="text-[9px]">{openSections.intelligence ? "▼" : "▶"}</span>
                <span>Intelligence & Links</span>
              </span>
              <span className="text-[9px] font-mono text-pd-accent">GRAPH</span>
            </div>
          ) : null}

          {(!openSections || openSections.intelligence || isSidebarCollapsed) && (
            <div className="space-y-0.5">
              <button
                onClick={() => openTab({ id: "tab-graph", type: "graph", title: "Macro Network", url: "raven://op-raven-01/graph" })}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-pd-xs transition-colors ${
                  activeTabId === "tab-graph"
                    ? "bg-pd-surface text-pd-accent font-semibold border-l-2 border-pd-accent"
                    : "text-pd-text-secondary hover:bg-pd-surface hover:text-pd-text-primary"
                } ${isSidebarCollapsed ? "justify-center px-0 h-9" : ""}`}
                title="Macro Criminal Graph"
              >
                <svg className="h-4 w-4 text-pd-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                {!isSidebarCollapsed && (
                  <div className="flex-1 flex items-center justify-between min-w-0">
                    <span className="truncate">Macro Graph Network</span>
                    <span className="rounded bg-pd-accent/15 px-1.5 py-0.5 text-[9px] font-mono text-pd-accent">3D/2D</span>
                  </div>
                )}
              </button>

              <button
                onClick={() => openTab({ id: "tab-profiles-dir", type: "profiles-dir", title: "Profiles Directory", url: "raven://op-raven-01/profiles" })}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-pd-xs transition-colors ${
                  activeTabId === "tab-profiles-dir"
                    ? "bg-pd-surface text-pd-accent font-semibold border-l-2 border-pd-accent"
                    : "text-pd-text-secondary hover:bg-pd-surface hover:text-pd-text-primary"
                } ${isSidebarCollapsed ? "justify-center px-0 h-9" : ""}`}
                title="Suspect Profiles Directory"
              >
                <svg className="h-4 w-4 text-pd-text-secondary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {!isSidebarCollapsed && (
                  <div className="flex-1 flex items-center justify-between min-w-0">
                    <span className="truncate">Suspect Dossiers</span>
                    <span className="rounded bg-pd-surface px-1.5 py-0.5 text-[9px] font-mono text-pd-text-tertiary">24</span>
                  </div>
                )}
              </button>

              <button
                onClick={() => openTab({ id: "tab-doc-sample", type: "document", title: "Document: FIR-124/2026", url: "raven://op-raven-01/documents" })}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-pd-xs transition-colors ${
                  activeTabId === "tab-doc-sample"
                    ? "bg-pd-surface text-pd-danger font-semibold border-l-2 border-pd-danger"
                    : "text-pd-text-secondary hover:bg-pd-surface hover:text-pd-text-primary"
                } ${isSidebarCollapsed ? "justify-center px-0 h-9" : ""}`}
                title="Document Forensics & OCR"
              >
                <svg className="h-4 w-4 text-pd-danger shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                {!isSidebarCollapsed && (
                  <div className="flex-1 flex items-center justify-between min-w-0">
                    <span className="truncate">Document Forensics</span>
                    <span className="rounded bg-pd-danger/15 px-1.5 py-0.5 text-[9px] font-mono text-pd-danger">OCR</span>
                  </div>
                )}
              </button>
            </div>
          )}
        </div>

        {/* SUBSECTION: 📹 SURVEILLANCE & CCTV */}
        <div className="space-y-1">
          {!isSidebarCollapsed ? (
            <div
              onClick={() => toggleSection("surveillance")}
              className="flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-pd-text-tertiary hover:text-pd-text-primary cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <span className="text-[9px]">{openSections.surveillance ? "▼" : "▶"}</span>
                <span>Surveillance & Vision</span>
              </span>
              <span className="text-[9px] font-mono text-pd-warning">4 CAMS</span>
            </div>
          ) : null}

          {(!openSections || openSections.surveillance || isSidebarCollapsed) && (
            <div className="space-y-0.5">
              <button
                onClick={() => openTab({ id: "tab-cctv", type: "vision", title: "CCTV Live Monitor - Cam 01", url: "raven://op-raven-01/vision" })}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-pd-xs transition-colors ${
                  activeTabId === "tab-cctv"
                    ? "bg-pd-surface text-pd-warning font-semibold border-l-2 border-pd-warning"
                    : "text-pd-text-secondary hover:bg-pd-surface hover:text-pd-text-primary"
                } ${isSidebarCollapsed ? "justify-center px-0 h-9" : ""}`}
                title="CCTV Live Streams & Re-ID"
              >
                <svg className="h-4 w-4 text-pd-warning shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {!isSidebarCollapsed && (
                  <div className="flex-1 flex items-center justify-between min-w-0">
                    <span className="truncate">CCTV Multi-Cam Matrix</span>
                    <span className="flex items-center gap-1 text-[9px] font-mono text-pd-success">
                      <span className="h-1.5 w-1.5 rounded-full bg-pd-success animate-pulse" />
                      LIVE
                    </span>
                  </div>
                )}
              </button>
            </div>
          )}
        </div>

        {/* SUBSECTION: 🗄️ DATA INGEST & REPOSITORIES */}
        <div className="space-y-1">
          {!isSidebarCollapsed ? (
            <div
              onClick={() => toggleSection("data")}
              className="flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-pd-text-tertiary hover:text-pd-text-primary cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <span className="text-[9px]">{openSections.data ? "▼" : "▶"}</span>
                <span>Data & Blockchain</span>
              </span>
              <span className="text-[9px] font-mono text-pd-success">STORE</span>
            </div>
          ) : null}

          {(!openSections || openSections.data || isSidebarCollapsed) && (
            <div className="space-y-0.5">
              <button
                onClick={() => openTab({ id: "tab-databases", type: "databases", title: "Data Sources & Ingest", url: "raven://op-raven-01/data-sources" })}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-pd-xs transition-colors ${
                  activeTabId === "tab-databases"
                    ? "bg-pd-surface text-pd-accent font-semibold border-l-2 border-pd-accent"
                    : "text-pd-text-secondary hover:bg-pd-surface hover:text-pd-text-primary"
                } ${isSidebarCollapsed ? "justify-center px-0 h-9" : ""}`}
                title="Data Repositories & Ingest"
              >
                <svg className="h-4 w-4 text-pd-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 7c0 1.657 3.582 3 8 3s8-1.343 8-3-3.582-3-8-3-8 1.343-8 3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 7v5c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 12v5c0 1.657 3.582 3 8 3s8-1.343 8-3v-5" />
                </svg>
                {!isSidebarCollapsed && (
                  <div className="flex-1 flex items-center justify-between min-w-0">
                    <span className="truncate">Ingest & Data Stores</span>
                    <span className="rounded bg-pd-surface px-1.5 py-0.5 text-[9px] font-mono text-pd-text-tertiary">4 Live</span>
                  </div>
                )}
              </button>

              <button
                onClick={() => openTab({ id: "tab-logs", type: "audit", title: "Audit Ledger", url: "raven://op-raven-01/audit" })}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-pd-xs transition-colors ${
                  activeTabId === "tab-logs"
                    ? "bg-pd-surface text-pd-success font-semibold border-l-2 border-pd-success"
                    : "text-pd-text-secondary hover:bg-pd-surface hover:text-pd-text-primary"
                } ${isSidebarCollapsed ? "justify-center px-0 h-9" : ""}`}
                title="Audit Ledger (Hyperledger Fabric)"
              >
                <svg className="h-4 w-4 text-pd-success shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {!isSidebarCollapsed && (
                  <div className="flex-1 flex items-center justify-between min-w-0">
                    <span className="truncate">Audit Ledger Log</span>
                    <span className="rounded bg-pd-success/15 px-1.5 py-0.5 text-[9px] font-mono text-pd-success">FABRIC</span>
                  </div>
                )}
              </button>
            </div>
          )}
        </div>

        {/* SUBSECTION: 🎯 PINNED TARGETS */}
        {!isSidebarCollapsed && (
          <div className="space-y-1 pt-1">
            <div
              onClick={() => toggleSection("targets")}
              className="flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-pd-text-tertiary hover:text-pd-text-primary cursor-pointer transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <span className="text-[9px]">{openSections.targets ? "▼" : "▶"}</span>
                <span>Primary Targets</span>
              </span>
              <span className="font-mono text-[9px] text-pd-danger font-bold">WATCHLIST</span>
            </div>

            {openSections.targets && (
              <div className="space-y-1 pl-1">
                {quickSuspects.map((suspect) => (
                  <button
                    key={suspect.id}
                    onClick={() =>
                      openTab({
                        id: `profile-${suspect.id}`,
                        type: "profile",
                        title: `Profile: ${suspect.name}`,
                        data: { entityId: suspect.id, entityName: suspect.name, role: suspect.role },
                      })
                    }
                    className="w-full flex items-center justify-between rounded p-2 text-pd-xs hover:bg-pd-surface text-left transition-colors border border-transparent hover:border-pd-border/60"
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="font-semibold text-pd-text-primary truncate">{suspect.name}</div>
                      <div className="text-[10px] text-pd-text-tertiary truncate">{suspect.role}</div>
                    </div>
                    <span className="rounded bg-pd-danger/15 border border-pd-danger/30 px-1.5 py-0.5 font-mono text-[10px] font-bold text-pd-danger">
                      {suspect.risk}%
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Footer System Hardware / VRAM Monitor & Officer Badge */}
      <div className="p-3 border-t border-pd-border/60 text-pd-xs bg-[#080b0f] space-y-2">
        {!isSidebarCollapsed ? (
          <>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-pd-text-tertiary">VRAM Allocation</span>
                <span className="font-mono text-pd-accent font-semibold">4.2 / 8.0 GB</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-pd-surface overflow-hidden">
                <div className="h-full bg-gradient-to-r from-pd-accent to-pd-success rounded-full" style={{ width: "52%" }} />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-pd-border/40">
              <div className="flex items-center gap-2">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-pd-accent/20 text-[10px] font-bold text-pd-accent">
                  IO
                </div>
                <div className="text-[11px] font-medium text-pd-text-secondary truncate">
                  IO A. Kumar
                </div>
              </div>

              {onOpenHealth && (
                <button
                  onClick={onOpenHealth}
                  className="flex items-center gap-1 text-[10px] font-mono text-pd-success hover:underline"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-pd-success animate-pulse" />
                  HEALTH
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={onOpenHealth}
              className="flex h-7 w-7 items-center justify-center rounded text-pd-success hover:bg-pd-surface"
              title="System Health"
            >
              <span className="h-2 w-2 rounded-full bg-pd-success animate-pulse" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
