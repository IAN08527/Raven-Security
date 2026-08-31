import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { TabBar } from "./components/TabBar";
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
import { useCaseStore } from "./store/case";

export default function App() {
  const [showHealth, setShowHealth] = useState(false);
  const tabs = useCaseStore((s) => s.tabs);
  const activeTabId = useCaseStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  return (
    <div className="flex h-full flex-col bg-pd-base text-pd-text-primary font-sans">
      {/* 28px App Header */}
      <Header onHealth={() => setShowHealth(true)} />

      {/* Main Workspace Layout */}
      <div className="flex min-h-0 flex-1">
        {/* 240px Left Navigation Sidebar */}
        <Sidebar />

        {/* Tabbed Canvas Area */}
        <main className="flex min-w-0 flex-1 flex-col bg-pd-base overflow-hidden">
          {/* 36px Dynamic Tab Bar */}
          <TabBar />

          {/* Active Workspace View Dispatcher */}
          <div className="min-h-0 flex-1 relative overflow-hidden">
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
            {activeTab?.type === "databases" && <DatabasesPane />}
          </div>
        </main>
      </div>

      {/* 24px Status Bar */}
      <StatusBar onHealth={() => setShowHealth(true)} />

      {/* Command Palette Modal Overlay (Ctrl+K / Ctrl+Shift+P) */}
      <CommandPalette />

      {/* Startup & Diagnostic Health Board Modal */}
      {showHealth && <HealthBoard onClose={() => setShowHealth(false)} />}
    </div>
  );
}
