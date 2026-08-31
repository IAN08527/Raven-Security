import { useState, type CSSProperties } from "react";
import { useCaseStore, type WorkspaceTab } from "../../store/case";

const AC = "#e8c15a";
const hexA = (h: string, a: number) => h + Math.round(a * 255).toString(16).padStart(2, "0");
const MONO = "'Spline Sans Mono',monospace";
const mono = (extra?: CSSProperties): CSSProperties => ({ fontFamily: MONO, ...extra });

interface BrowserSidebarProps {
  zuluTime?: string;
}

export function BrowserSidebar({ zuluTime }: BrowserSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [newTabMenuOpen, setNewTabMenuOpen] = useState(false);

  const caseId = useCaseStore((s) => s.caseId);
  const activeNav = useCaseStore((s) => s.activeNav);
  const setActiveNav = useCaseStore((s) => s.setActiveNav);
  const tabs = useCaseStore((s) => s.tabs);
  const activeTabId = useCaseStore((s) => s.activeTabId);
  const setActiveTab = useCaseStore((s) => s.setActiveTab);
  const closeTab = useCaseStore((s) => s.closeTab);
  const openTab = useCaseStore((s) => s.openTab);
  const setCommandPaletteOpen = useCaseStore((s) => s.setCommandPaletteOpen);
  const openIngestModal = useCaseStore((s) => s.openIngestModal);

  const handleOpenModule = (navId: "profiles" | "graph" | "cctv" | "logs" | "databases") => {
    setActiveNav(navId);
  };

  const handleCreateTab = (type: WorkspaceTab["type"], title: string, id: string) => {
    openTab({ id, type, title });
    setNewTabMenuOpen(false);
  };

  const getTabIcon = (type: string, active: boolean) => {
    const col = active ? AC : "#98a4b3";
    switch (type) {
      case "profile":
        return (
          <svg style={{ width: 14, height: 14, color: active ? AC : "#ff5a3c" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        );
      case "profiles-dir":
        return (
          <svg style={{ width: 14, height: 14, color: col }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        );
      case "graph":
        return (
          <svg style={{ width: 14, height: 14, color: active ? AC : "#5ecf9a" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
        );
      case "vision":
        return (
          <svg style={{ width: 14, height: 14, color: active ? AC : "#e0a63d" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        );
      case "audit":
        return (
          <svg style={{ width: 14, height: 14, color: active ? AC : "#5ecf9a" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        );
      case "document":
        return (
          <svg style={{ width: 14, height: 14, color: active ? AC : "#ff5a3c" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        );
      case "databases":
        return (
          <svg style={{ width: 14, height: 14, color: active ? AC : "#e8c15a" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7c0 1.657 3.582 3 8 3s8-1.343 8-3-3.582-3-8-3-8 1.343-8 3zM4 7v5c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 12v5c0 1.657 3.582 3 8 3s8-1.343 8-3v-5" />
          </svg>
        );
      default:
        return (
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: active ? AC : "#5c6773" }} />
        );
    }
  };

  const width = collapsed ? 64 : 260;

  return (
    <aside
      style={{
        width,
        minWidth: width,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#080b0e",
        borderRight: "1px solid #1b212b",
        userSelect: "none",
        zIndex: 20,
        transition: "width 0.2s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        overflow: "hidden",
      }}
    >
      {/* ══ 1. TOP BRAND & CASE BADGE ══ */}
      <div style={{ padding: collapsed ? "12px 0" : "12px 14px", borderBottom: "1px solid #1b212b", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 10, height: 10, background: AC, clipPath: "polygon(0 0,100% 0,100% 65%,65% 100%,0 100%)", flexShrink: 0 }} />
            {!collapsed && (
              <span style={mono({ fontWeight: 700, fontSize: 13, letterSpacing: ".24em", color: "#e8edf2" })}>
                RAVEN
              </span>
            )}
          </div>
          {!collapsed && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, ...mono({ fontSize: 10, color: AC }) }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#5ecf9a", animation: "rvsPulse 2.4s infinite" }} />
              {caseId}
            </div>
          )}
        </div>

        {/* Action Buttons (Ingest + Search) */}
        {!collapsed ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              onClick={openIngestModal}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                height: 30,
                width: "100%",
                background: hexA(AC, 0.12),
                border: `1px solid ${hexA(AC, 0.4)}`,
                color: AC,
                ...mono({ fontSize: 11, fontWeight: 700 }),
                letterSpacing: ".08em",
                cursor: "pointer",
                borderRadius: 2,
              }}
            >
              <span>↑</span> INGEST DATASET
            </button>

            <button
              onClick={() => setCommandPaletteOpen(true)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                height: 28,
                width: "100%",
                padding: "0 10px",
                background: "#0b0e12",
                border: "1px solid #1b212b",
                color: "#5c6773",
                ...mono({ fontSize: 10 }),
                cursor: "pointer",
                borderRadius: 2,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: AC }}>›_</span> Search suspects...
              </span>
              <kbd style={{ fontSize: 9, border: "1px solid #232b37", padding: "0 4px", color: "#5c6773" }}>⌃K</kbd>
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <button
              onClick={openIngestModal}
              title="Ingest Dataset"
              style={{
                width: 34,
                height: 34,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: hexA(AC, 0.12),
                border: `1px solid ${hexA(AC, 0.4)}`,
                color: AC,
                cursor: "pointer",
                borderRadius: 2,
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              ↑
            </button>
            <button
              onClick={() => setCommandPaletteOpen(true)}
              title="Search (Ctrl+K)"
              style={{
                width: 34,
                height: 30,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#0b0e12",
                border: "1px solid #1b212b",
                color: AC,
                cursor: "pointer",
                borderRadius: 2,
                fontFamily: MONO,
                fontSize: 11,
              }}
            >
              ›_
            </button>
          </div>
        )}
      </div>

      {/* ══ 2. PINNED SPACES & PRIMARY MODULES ══ */}
      <div style={{ padding: collapsed ? "8px 0" : "10px 10px 6px", borderBottom: "1px solid #1b212b" }}>
        {!collapsed && (
          <div style={{ padding: "0 4px 6px", ...mono({ fontSize: 9, fontWeight: 700, letterSpacing: ".14em", color: "#5c6773" }) }}>
            PINNED SPACES
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {[
            { id: "profiles" as const, num: "01", label: "PROFILES", tabId: "tab-profiles-dir", title: "Profiles Directory", type: "profiles-dir" as const },
            { id: "graph" as const, num: "02", label: "MACRO GRAPH", tabId: "tab-graph", title: "Macro Network", type: "graph" as const },
            { id: "cctv" as const, num: "03", label: "CCTV OPTICS", tabId: "tab-cctv", title: "CCTV Live Monitor - Cam 01", type: "vision" as const },
            { id: "logs" as const, num: "04", label: "AUDIT LEDGER", tabId: "tab-logs", title: "Audit Ledger", type: "audit" as const },
            { id: "databases" as const, num: "05", label: "DATA SOURCES", tabId: "tab-databases", title: "Data Sources", type: "databases" as const },
          ].map((m) => {
            const isTabActive = tabs.find((t) => t.id === activeTabId)?.type === m.type;
            return (
              <button
                key={m.id}
                onClick={() => handleOpenModule(m.id)}
                title={m.title}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: collapsed ? "center" : "flex-start",
                  gap: 10,
                  height: 32,
                  padding: collapsed ? 0 : "0 10px",
                  background: isTabActive ? "#0c1015" : "transparent",
                  border: "none",
                  borderLeft: isTabActive ? `3px solid ${AC}` : "3px solid transparent",
                  cursor: "pointer",
                  color: isTabActive ? "#e8edf2" : "#98a4b3",
                  borderRadius: 2,
                  width: "100%",
                  boxSizing: "border-box",
                }}
              >
                <span style={mono({ fontSize: 10, fontWeight: 700, color: isTabActive ? AC : "#5c6773" })}>
                  {m.num}
                </span>
                {!collapsed && (
                  <span style={{ fontSize: 11, fontWeight: isTabActive ? 700 : 500, letterSpacing: ".06em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {m.label}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ══ 3. VERTICAL BROWSER TABS SECTION (OPEN TABS) ══ */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: collapsed ? "8px 0" : "10px 10px", overflowY: "auto" }}>
        {/* Section Header with + New Tab button */}
        {!collapsed ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px 8px" }}>
            <span style={mono({ fontSize: 9, fontWeight: 700, letterSpacing: ".14em", color: "#5c6773" })}>
              OPEN TABS ({tabs.length})
            </span>
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setNewTabMenuOpen(!newTabMenuOpen)}
                title="New Tab"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 20,
                  height: 20,
                  background: "#0b0e12",
                  border: "1px solid #1b212b",
                  color: "#98a4b3",
                  cursor: "pointer",
                  borderRadius: 2,
                  fontSize: 12,
                }}
              >
                +
              </button>

              {/* New Tab Dropdown Menu */}
              {newTabMenuOpen && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 24,
                    width: 170,
                    background: "#080b0e",
                    border: "1px solid #1b212b",
                    boxShadow: "0 10px 30px rgba(0,0,0,.7)",
                    zIndex: 50,
                    padding: 4,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <button
                    onClick={() => handleCreateTab("profiles-dir", "Profiles Directory", `tab-dir-${Date.now()}`)}
                    style={dropdownItemStyle}
                  >
                    👥 Suspects Roster
                  </button>
                  <button
                    onClick={() => handleCreateTab("graph", "Macro Network", `tab-graph-${Date.now()}`)}
                    style={dropdownItemStyle}
                  >
                    🕸 Macro Network
                  </button>
                  <button
                    onClick={() => handleCreateTab("vision", "CCTV Monitor", `tab-cctv-${Date.now()}`)}
                    style={dropdownItemStyle}
                  >
                    📹 CCTV Live Feeds
                  </button>
                  <button
                    onClick={() => handleCreateTab("audit", "Audit Ledger", `tab-audit-${Date.now()}`)}
                    style={dropdownItemStyle}
                  >
                    📜 Blockchain Ledger
                  </button>
                  <button
                    onClick={() => handleCreateTab("databases", "Data Sources", `tab-dbs-${Date.now()}`)}
                    style={dropdownItemStyle}
                  >
                    🗄 Data Sources
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
            <button
              onClick={() => setNewTabMenuOpen(!newTabMenuOpen)}
              title="New Tab"
              style={{
                width: 28,
                height: 24,
                background: "#0b0e12",
                border: "1px solid #1b212b",
                color: "#98a4b3",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              +
            </button>
          </div>
        )}

        {/* Tab Items List */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, overflowY: "auto" }}>
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.title}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: collapsed ? "center" : "space-between",
                  height: collapsed ? 36 : 40,
                  padding: collapsed ? 0 : "0 8px 0 10px",
                  background: isActive ? hexA(AC, 0.08) : "#0b0e12",
                  border: `1px solid ${isActive ? hexA(AC, 0.4) : "#161c24"}`,
                  borderLeft: `3px solid ${isActive ? AC : "#232b37"}`,
                  borderRadius: 2,
                  cursor: "pointer",
                  transition: "all 0.1s ease",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                  <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                    {getTabIcon(tab.type, isActive)}
                  </span>
                  {!collapsed && (
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: isActive ? 700 : 500,
                          color: isActive ? "#e8edf2" : "#98a4b3",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {tab.title}
                      </div>
                      <div
                        style={{
                          ...mono({ fontSize: 8 }),
                          color: isActive ? AC : "#5c6773",
                          textTransform: "uppercase",
                          letterSpacing: ".06em",
                          marginTop: 1,
                        }}
                      >
                        {tab.type}
                      </div>
                    </div>
                  )}
                </div>

                {/* Close Tab button (✕) */}
                {!collapsed && tabs.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    title="Close tab"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#5c6773",
                      cursor: "pointer",
                      fontSize: 12,
                      padding: "2px 4px",
                      borderRadius: 2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "#ff5a3c";
                      e.currentTarget.style.background = "rgba(255,90,60,.15)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "#5c6773";
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ══ 4. BOTTOM FOOTER & COLLAPSE CONTROLS ══ */}
      <div style={{ padding: collapsed ? "10px 0" : "10px 14px", borderTop: "1px solid #1b212b", background: "#060809", display: "flex", flexDirection: "column", gap: 8 }}>
        {!collapsed ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${hexA(AC, 0.4)}`, background: hexA(AC, 0.1), color: AC, fontSize: 9, fontWeight: 700, fontFamily: MONO }}>
                AK
              </span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#e8edf2" }}>IO A. Kumar</div>
                <div style={mono({ fontSize: 8, color: "#5ecf9a" })}>
                  ● ALL SYSTEMS LIVE
                </div>
              </div>
            </div>

            <button
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
              style={{
                background: "transparent",
                border: "1px solid #1b212b",
                color: "#5c6773",
                padding: "2px 6px",
                cursor: "pointer",
                fontFamily: MONO,
                fontSize: 10,
              }}
            >
              ◀
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <span style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${hexA(AC, 0.4)}`, background: hexA(AC, 0.1), color: AC, fontSize: 9, fontWeight: 700, fontFamily: MONO }}>
              AK
            </span>
            <button
              onClick={() => setCollapsed(false)}
              title="Expand sidebar"
              style={{
                background: "transparent",
                border: "1px solid #1b212b",
                color: AC,
                padding: "2px 6px",
                cursor: "pointer",
                fontFamily: MONO,
                fontSize: 10,
              }}
            >
              ▶
            </button>
          </div>
        )}

        {!collapsed && zuluTime && (
          <div style={{ display: "flex", justifyContent: "space-between", ...mono({ fontSize: 9, color: "#5c6773" }), borderTop: "1px solid #12161d", paddingTop: 6 }}>
            <span>SYSTEM CLOCK</span>
            <span style={{ color: AC, fontWeight: 600 }}>{zuluTime}</span>
          </div>
        )}
      </div>
    </aside>
  );
}

const dropdownItemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "6px 8px",
  background: "transparent",
  border: "none",
  color: "#e8edf2",
  fontSize: 11,
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "'Instrument Sans',sans-serif",
  borderRadius: 2,
};
