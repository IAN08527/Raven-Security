import { CSSProperties, useEffect, useState } from "react";
import { useCaseStore } from "../store/case";
import { BrowserSidebar } from "../components/sidebar/BrowserSidebar";
import { ProfilesDirectoryPane } from "../components/profiles/ProfilesDirectoryPane";
import { ProfileWorkspacePane } from "../components/profiles/ProfileWorkspacePane";
import { GraphPane } from "../components/graph/GraphPane";
import { VisionPane } from "../components/vision/VisionPane";
import { AuditPanel } from "../components/audit/AuditPanel";
import { DocumentViewerPane } from "../components/documents/DocumentViewerPane";
import { DatabasesPane } from "../components/databases/DatabasesPane";
import { CommandPalette } from "../components/CommandPalette";
import { GlobalIngestModal } from "../components/ingest/GlobalIngestModal";

/**
 * RavenShell — Vertical Browser Tab Layout
 *
 * Modern browser-style vertical sidebar featuring:
 * - Pinned space shortcuts (Profiles, Macro Network, Optics, Ledger, Sources)
 * - Dynamic open vertical tabs with type icons, active indicators, and close buttons
 * - One-click + New Tab launcher
 * - Global Ingest Dataset trigger
 * - Full-height canvas with clean breadcrumbs header
 */

const AC = "#e8c15a";
const hexA = (h: string, a: number) => h + Math.round(a * 255).toString(16).padStart(2, "0");
const MONO = "'Spline Sans Mono',monospace";
const mono = (extra?: CSSProperties): CSSProperties => ({ fontFamily: MONO, ...extra });

const MOD_TITLES: Record<string, string> = {
  profiles: "SUBJECT ROSTER",
  graph: "MACRO NETWORK",
  cctv: "CCTV LIVE MONITOR",
  logs: "AUDIT LEDGER",
  databases: "DATA SOURCES",
};

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Spline+Sans+Mono:wght@400;500;600;700&display=swap');
@keyframes rvsPulse{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes rvsSweep{from{transform:scaleX(0)}to{transform:scaleX(1)}}
`;

export default function RavenShell() {
  const activeNav = useCaseStore((s) => s.activeNav);
  const setCommandPaletteOpen = useCaseStore((s) => s.setCommandPaletteOpen);
  const notification = useCaseStore((s) => s.notification);
  const setNotification = useCaseStore((s) => s.setNotification);
  const tabs = useCaseStore((s) => s.tabs);
  const activeTabId = useCaseStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const [zulu, setZulu] = useState("");
  useEffect(() => {
    const tick = () =>
      setZulu(
        new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) + " UTC"
      );
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const curTitle = MOD_TITLES[activeNav] || "ACTIVE WORKSPACE";

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100vw",
        background: "#060809",
        color: "#e8edf2",
        overflow: "hidden",
        fontFamily: "'Instrument Sans',system-ui,sans-serif",
        fontSize: 13,
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />

      {/* ══ 1. LEFT VERTICAL BROWSER TAB SIDEBAR ══ */}
      <BrowserSidebar zuluTime={zulu} />

      {/* ══ 2. RIGHT WORKSPACE AREA ══ */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        {/* Slim Workspace Sub-Header / Breadcrumbs */}
        <header
          style={{
            display: "flex",
            height: 38,
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #1b212b",
            background: "#080b0e",
            padding: "0 18px",
            flexShrink: 0,
            userSelect: "none",
          }}
        >
          {/* Active Tab Breadcrumb */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, minWidth: 0 }}>
            <span style={mono({ color: "#5c6773", fontSize: 10, letterSpacing: ".12em" })}>RAVEN</span>
            <span style={{ color: "#232b37" }}>›</span>
            <span style={mono({ color: "#98a4b3", fontSize: 11, letterSpacing: ".08em" })}>{curTitle}</span>
            <span style={{ color: "#232b37" }}>›</span>
            <span style={{ fontWeight: 600, color: "#e8edf2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeTab?.title ?? curTitle}
            </span>
          </div>

          {/* Quick Right Telemetry & Search */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              onClick={() => setCommandPaletteOpen(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "#0b0e12",
                border: "1px solid #1b212b",
                color: "#5c6773",
                padding: "3px 8px",
                borderRadius: 2,
                cursor: "pointer",
                ...mono({ fontSize: 10 }),
              }}
            >
              <span style={{ color: AC }}>›_</span>
              <span>Find</span>
              <kbd style={{ fontSize: 8, border: "1px solid #232b37", padding: "0 3px", color: "#5c6773" }}>⌃K</kbd>
            </button>

            <span style={{ width: 1, height: 14, background: "#1b212b" }} />

            <div style={{ display: "flex", alignItems: "center", gap: 6, ...mono({ fontSize: 10, color: "#5ecf9a" }) }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#5ecf9a", animation: "rvsPulse 2.4s infinite" }} />
              LIVE
            </div>
          </div>
        </header>

        {/* Main Canvas Dispatcher */}
        <main style={{ minHeight: 0, flex: 1, position: "relative", overflow: "hidden", background: "#060809" }}>
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
        </main>

        {/* Status Ticker Footer */}
        <footer
          style={{
            display: "flex",
            height: 26,
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid #1b212b",
            background: "#080b0e",
            padding: "0 18px",
            ...mono({ fontSize: 9 }),
            letterSpacing: ".08em",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, overflow: "hidden", whiteSpace: "nowrap" }}>
            <span style={{ color: "#98a4b3" }}>{curTitle}</span>
            <span style={{ color: "#232b37" }}>▪</span>
            <span style={{ color: "#5c6773" }}>{activeTab?.title ?? ""}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, whiteSpace: "nowrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#5ecf9a" }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#5ecf9a", animation: "rvsPulse 2.4s infinite" }} />
              ALL SYSTEMS LIVE
            </span>
          </div>
        </footer>
      </div>

      {/* Global command palette (⌃K) */}
      <CommandPalette />

      {/* Global Ingestion Modal */}
      <GlobalIngestModal />

      {/* Floating Ingestion Toast Notification */}
      {notification && (
        <div
          style={{
            position: "fixed",
            bottom: 36,
            right: 24,
            zIndex: 9999,
            display: "flex",
            maxWidth: 420,
            alignItems: "flex-start",
            gap: 12,
            border: `1px solid ${hexA(AC, 0.5)}`,
            background: "#080b0e",
            padding: 14,
            boxShadow: "0 20px 50px rgba(0,0,0,.8)",
            fontFamily: "'Instrument Sans',system-ui,sans-serif",
            color: "#e8edf2",
          }}
        >
          <div
            style={{
              display: "flex",
              height: 24,
              width: 24,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "50%",
              background: "rgba(94,207,154,.2)",
              color: "#5ecf9a",
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            ✓
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontWeight: 600, fontSize: 13 }}>
              <span>{notification.message}</span>
              <button
                onClick={() => setNotification(null)}
                style={{ background: "none", border: "none", color: "#5c6773", cursor: "pointer", fontSize: 12, marginLeft: 8 }}
              >
                ✕
              </button>
            </div>
            {notification.details && (
              <div style={{ marginTop: 4, color: "#98a4b3", fontSize: 11, ...mono({ fontSize: 11 }) }}>
                {notification.details}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
