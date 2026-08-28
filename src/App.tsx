import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { HealthBoard } from "./components/HealthBoard";
import { GraphPane } from "./components/graph/GraphPane";
import { MapPane } from "./components/map/MapPane";
import { VisionPane } from "./components/vision/VisionPane";
import { EvidencePane } from "./components/evidence/EvidencePane";
import { AnomalyInbox } from "./components/anomaly/AnomalyInbox";
import { AuditPanel } from "./components/audit/AuditPanel";
import { useCaseStore } from "./store/case";

export default function App() {
  const [showHealth, setShowHealth] = useState(true);
  const activeView = useCaseStore((s) => s.activeView);

  return (
    <div className="flex h-full flex-col bg-pd-base text-pd-text-primary">
      <header className="flex h-7 items-center gap-3 border-b border-pd-border bg-pd-base px-3 text-pd-sm">
        <span className="font-semibold text-pd-accent">Raven</span>
        <nav className="flex gap-3 text-pd-text-secondary">
          <span>File</span>
          <span>Edit</span>
          <span>View</span>
          <span>Tools</span>
          <span>Help</span>
        </nav>
        <button
          className="ml-auto text-pd-text-secondary hover:text-pd-text-primary"
          onClick={() => setShowHealth(true)}
        >
          Health
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            {activeView === "graph" && <GraphPane />}
            {activeView === "map" && <MapPane />}
            {activeView === "vision" && <VisionPane />}
            {activeView === "audit" && <AuditPanel />}
          </div>
          <AnomalyInbox />
        </main>

        <aside className="w-[280px] border-l border-pd-border bg-pd-surface">
          <EvidencePane />
        </aside>
      </div>

      <StatusBar onHealth={() => setShowHealth(true)} />

      {showHealth && <HealthBoard onClose={() => setShowHealth(false)} />}
    </div>
  );
}
