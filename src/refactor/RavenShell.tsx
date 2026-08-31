import { CSSProperties, useEffect, useState } from "react";
import { useCaseStore } from "../store/case";
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
 * RavenShell — the RAVEN design-refactor shell wired to the REAL app.
 *
 * Reuses the visual language from the design mockup (top command bar, numbered
 * module nav, yellow accent, status ticker) but the canvas mounts the real
 * feature panes via the same dispatcher `App.tsx` uses — so the data and logic
 * are real, not mock. Navigation drives the existing case store (`setActiveNav`),
 * which keeps dynamic profile/document tabs working.
 */

const AC = "#e8c15a";
const hexA = (h: string, a: number) => h + Math.round(a * 255).toString(16).padStart(2, "0");
const acDim = hexA(AC, 0.1);
const acBorder = hexA(AC, 0.35);
const MONO = "'Spline Sans Mono',monospace";
const mono = (extra?: CSSProperties): CSSProperties => ({ fontFamily: MONO, ...extra });

type Nav = "profiles" | "graph" | "cctv" | "logs" | "databases";
const MODS: { id: Nav; num: string; label: string; title: string }[] = [
  { id: "profiles", num: "01", label: "PROFILES", title: "SUBJECT ROSTER" },
  { id: "graph", num: "02", label: "NETWORK", title: "MACRO NETWORK" },
  { id: "cctv", num: "03", label: "OPTICS", title: "CCTV LIVE MONITOR" },
  { id: "logs", num: "04", label: "LEDGER", title: "AUDIT LEDGER" },
  { id: "databases", num: "05", label: "SOURCES", title: "DATA SOURCES" },
];

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Spline+Sans+Mono:wght@400;500;600;700&display=swap');
.rvs-modbtn:hover{background:#0c1015 !important}
.rvs-hoverAc:hover{border-color:${acBorder} !important;color:${AC} !important}
@keyframes rvsPulse{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes rvsSweep{from{transform:scaleX(0)}to{transform:scaleX(1)}}
`;

export default function RavenShell() {
  const caseId = useCaseStore((s) => s.caseId);
  const activeNav = useCaseStore((s) => s.activeNav);
  const setActiveNav = useCaseStore((s) => s.setActiveNav);
  const setCommandPaletteOpen = useCaseStore((s) => s.setCommandPaletteOpen);
  const openIngestModal = useCaseStore((s) => s.openIngestModal);
  const notification = useCaseStore((s) => s.notification);
  const setNotification = useCaseStore((s) => s.setNotification);
  const tabs = useCaseStore((s) => s.tabs);
  const activeTabId = useCaseStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const [zulu, setZulu] = useState("");
  useEffect(() => {
    const tick = () =>
      setZulu(
        new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }) + " ZULU"
      );
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, []);

  const [vw, setVw] = useState(typeof window !== "undefined" ? window.innerWidth : 1440);
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const narrow = vw < 1150;

  const cur = MODS.find((m) => m.id === activeNav) ?? MODS[0];

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", height: "100vh",
        background: "#060809", color: "#e8edf2", overflow: "hidden",
        fontFamily: "'Instrument Sans',system-ui,sans-serif", fontSize: 13,
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />

      {/* ══ TOP BAR ══ */}
      <header style={{ display: "flex", height: 48, alignItems: "center", borderBottom: "1px solid #1b212b", background: "#080b0e", flexShrink: 0, padding: "0 16px", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ width: 10, height: 10, background: AC, clipPath: "polygon(0 0,100% 0,100% 65%,65% 100%,0 100%)" }} />
          <span style={mono({ fontWeight: 700, fontSize: 15, letterSpacing: ".28em", color: "#e8edf2" })}>RAVEN</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0, borderLeft: "1px solid #1b212b", paddingLeft: 16, whiteSpace: "nowrap" }}>
          <span style={mono({ fontSize: 13, fontWeight: 600, letterSpacing: ".06em", color: AC })}>{caseId}</span>
          <span title="Case live" style={{ width: 6, height: 6, borderRadius: "50%", background: "#5ecf9a", animation: "rvsPulse 2.4s infinite" }} />
        </div>

        <nav style={{ display: "flex", alignItems: "stretch", height: "100%", flex: 1, minWidth: 0, overflow: "hidden" }}>
          {MODS.map((m) => {
            const act = activeNav === m.id;
            return (
              <button key={m.id} className="rvs-modbtn" onClick={() => setActiveNav(m.id)}
                style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, padding: "0 clamp(8px,1.4vw,18px)", background: act ? "#0c1015" : "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", flex: "0 0 auto" }}>
                <span style={mono({ fontSize: 11, fontWeight: 700, color: act ? AC : "#3d4653" })}>{m.num}</span>
                {!(narrow && !act) && (
                  <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".1em", color: act ? "#e8edf2" : "#7d8894", whiteSpace: "nowrap" }}>{m.label}</span>
                )}
                {act && <span style={{ position: "absolute", left: 0, bottom: -1, height: 2, width: "100%", background: AC, transformOrigin: "left", animation: "rvsSweep .28s cubic-bezier(.16,1,.3,1)" }} />}
              </button>
            );
          })}
        </nav>

        {/* Global Ingest Action Button */}
        <button
          onClick={openIngestModal}
          className="rvs-hoverAc"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 30,
            padding: "0 12px",
            background: acDim,
            border: `1px solid ${acBorder}`,
            color: AC,
            ...mono({ fontSize: 11, fontWeight: 700 }),
            cursor: "pointer",
            letterSpacing: ".06em",
            whiteSpace: "nowrap",
          }}
          title="Upload and scan investigative datasets"
        >
          <span>↑</span> INGEST DATA
        </button>

        {/* Command Palette Trigger */}
        <button onClick={() => setCommandPaletteOpen(true)} className="rvs-hoverAc"
          style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 1 150px", minWidth: 90, height: 30, padding: "0 12px", background: "#0b0e12", border: "1px solid #1b212b", color: "#5c6773", ...mono({ fontSize: 11 }), cursor: "pointer", letterSpacing: ".04em" }}>
          <span style={{ color: AC }}>›_</span>
          <span style={{ flex: 1, textAlign: "left", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>search</span>
          <kbd style={{ fontSize: 9, border: "1px solid #232b37", padding: "1px 5px", color: "#5c6773", fontFamily: "inherit" }}>⌃K</kbd>
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, borderLeft: "1px solid #1b212b", paddingLeft: 16, ...mono({ fontSize: 10 }), letterSpacing: ".08em", whiteSpace: "nowrap" }}>
          <span title="IO A. Kumar" style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${acBorder}`, background: acDim, color: AC, fontSize: 9, fontWeight: 700 }}>AK</span>
          <span style={{ color: AC, fontWeight: 600 }}>{zulu}</span>
        </div>
      </header>

      {/* ══ CANVAS — real panes via the App dispatcher ══ */}
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

      {/* ══ STATUS TICKER ══ */}
      <footer style={{ display: "flex", height: 28, alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #1b212b", background: "#080b0e", padding: "0 18px", ...mono({ fontSize: 9 }), letterSpacing: ".1em", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, overflow: "hidden", whiteSpace: "nowrap" }}>
          <span style={{ color: "#98a4b3" }}>{cur.title}</span><span style={{ color: "#232b37" }}>▪</span>
          <span style={{ color: "#5c6773" }}>{activeTab?.title ?? ""}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, whiteSpace: "nowrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#5ecf9a" }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#5ecf9a", animation: "rvsPulse 2.4s infinite" }} />ALL SYSTEMS LIVE</span>
        </div>
      </footer>

      {/* Global command palette (⌃K) */}
      <CommandPalette />

      {/* Global Ingestion Modal */}
      <GlobalIngestModal />

      {/* Floating Ingestion Toast Notification */}
      {notification && (
        <div style={{
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
        }}>
          <div style={{ display: "flex", height: 24, width: 24, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "rgba(94,207,154,.2)", color: "#5ecf9a", fontWeight: 700, fontSize: 12 }}>
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
