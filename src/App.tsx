import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { HealthBoard } from "./components/HealthBoard";
import { CommandPalette } from "./components/CommandPalette";
import { GraphPane } from "./components/graph/GraphPane";
import { ProfilesDirectoryPane } from "./components/profiles/ProfilesDirectoryPane";
import { ProfileWorkspacePane } from "./components/profiles/ProfileWorkspacePane";
import { VisionPane } from "./components/vision/VisionPane";
import { AuditPanel } from "./components/audit/AuditPanel";
import { DocumentViewerPane } from "./components/documents/DocumentViewerPane";
import { DatabasesPane } from "./components/databases/DatabasesPane";
import { DynamicIngestModal } from "./components/pipeline/DynamicIngestModal";
import { useCaseStore } from "./store/case";

export default function App() {
  const [showHealth, setShowHealth] = useState(false);
  const tabs = useCaseStore((s) => s.tabs);
  const activeTabId = useCaseStore((s) => s.activeTabId);
  const caseId = useCaseStore((s) => s.caseId);
  const isSidebarCollapsed = useCaseStore((s) => s.isSidebarCollapsed);
  const toggleSidebar = useCaseStore((s) => s.toggleSidebar);
  const ingestModalOpen = useCaseStore((s) => s.ingestModalOpen);
  const setIngestModalOpen = useCaseStore((s) => s.setIngestModalOpen);
  const setCommandPaletteOpen = useCaseStore((s) => s.setCommandPaletteOpen);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  return (
    <div className="flex h-full flex-row bg-pd-base text-pd-text-primary font-sans overflow-hidden">
      {/* 1. Full-Height Sidebar with Subsections & Vertical Tabs */}
      <Sidebar onOpenHealth={() => setShowHealth(true)} />

      {/* 2. Main Investigation Canvas */}
      <div className="flex min-w-0 flex-1 flex-col bg-[#0b0e14] overflow-hidden relative">
        {/* Minimal Canvas Breadcrumbs & Quick Bar */}
        <header className="flex h-8 items-center justify-between border-b border-pd-border/60 bg-[#090c12] px-3 text-pd-xs select-none shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {isSidebarCollapsed && (
              <button
                onClick={toggleSidebar}
                className="rounded p-1 text-pd-text-secondary hover:bg-pd-surface hover:text-pd-accent transition-colors mr-1"
                title="Expand Sidebar"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
              </button>
            )}
            <span className="font-mono text-pd-text-tertiary">{caseId}</span>
            <span className="text-pd-text-tertiary">/</span>
            <span className="font-semibold text-pd-text-primary truncate">{activeTab?.title}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIngestModalOpen(true)}
              className="flex items-center gap-1 rounded bg-pd-accent/15 border border-pd-accent/30 px-2 py-0.5 text-[10px] font-mono font-semibold text-pd-accent hover:bg-pd-accent hover:text-pd-base transition-colors"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span>Ingest</span>
            </button>

            <button
              onClick={() => setCommandPaletteOpen(true)}
              className="flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] text-pd-text-tertiary hover:text-pd-text-primary hover:bg-pd-surface transition-colors"
            >
              <kbd className="font-mono bg-pd-base px-1 py-0.5 rounded border border-pd-border">Ctrl+K</kbd>
            </button>
          </div>
        </header>

        {/* Dynamic Workspace View Dispatcher */}
        <main className="min-h-0 flex-1 relative overflow-hidden">
          {activeTab?.type === "profiles-dir" && <ProfilesDirectoryPane />}
          {activeTab?.type === "graph" && <GraphPane />}
          {activeTab?.type === "profile" && (
            <ProfileWorkspacePane
              key={activeTab.id}
              entityId={activeTab.data?.entityId}
              entityName={activeTab.data?.entityName}
            />
          )}
          {activeTab?.type === "document" && (
            <DocumentViewerPane
              key={activeTab.id}
              docId={activeTab.data?.docId}
              title={activeTab.title}
              data={activeTab.data as never}
            />
          )}
          {activeTab?.type === "vision" && <VisionPane />}
          {activeTab?.type === "audit" && <AuditPanel />}
          {(activeTab?.type === "databases" || activeTab?.type === "ingest") && <DatabasesPane />}
        </main>

        {/* Bottom Status Bar */}
        <StatusBar onHealth={() => setShowHealth(true)} />
      </div>

      {/* Command Palette Modal Overlay (Ctrl+K / Ctrl+Shift+P) */}
      <CommandPalette />

      {/* Dynamic Ingest & Forensics Pipeline Workbench Modal */}
      {ingestModalOpen && <DynamicIngestModal onClose={() => setIngestModalOpen(false)} />}

      {/* Startup & Diagnostic Health Board Modal */}
      {showHealth && <HealthBoard onClose={() => setShowHealth(false)} />}
    </div>
  );
}
