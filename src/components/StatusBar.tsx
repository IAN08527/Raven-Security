import { useState, useEffect } from "react";
import { useCaseStore } from "../store/case";

export function StatusBar({ onHealth }: { onHealth: () => void }) {
  const caseId = useCaseStore((s) => s.caseId) || "OP-RAVEN-01";
  const tabs = useCaseStore((s) => s.tabs);
  const activeTabId = useCaseStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const [time, setTime] = useState<string>("16:00 ZULU");

  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setTime(
        `${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })} ZULU`
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <footer className="flex h-6 items-center justify-between border-t border-pd-border bg-pd-surface px-3 text-pd-xs text-pd-text-secondary select-none font-mono">
      {/* Left Details */}
      <div className="flex items-center gap-3">
        <span className="font-bold text-pd-accent">{caseId}</span>
        <span className="text-pd-border">|</span>
        <span className="text-pd-text-primary font-sans font-medium truncate max-w-[240px]">
          {activeTab?.title || "Workspace"}
        </span>
        <span className="text-pd-border">|</span>
        <span className="text-pd-text-tertiary">14 Persons, 6 Orgs, 8 Accounts</span>
      </div>

      {/* Right Details */}
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 text-pd-success text-[11px]">
          <span className="h-1.5 w-1.5 rounded-full bg-pd-success animate-pulse" />
          Postgres Live
        </span>
        <span className="text-pd-border">|</span>
        <button
          onClick={onHealth}
          className="hover:text-pd-text-primary text-[11px] transition-colors"
        >
          Health Board
        </button>
        <span className="text-pd-border">|</span>
        <span className="text-pd-text-tertiary text-[11px]">{time}</span>
      </div>
    </footer>
  );
}
