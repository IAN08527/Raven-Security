import { useMemo, useState } from "react";
import { useCaseStore } from "../../store/case";
import {
  INTEGRITY_CHECKS,
  DATA_CATEGORIES,
  PIPELINE_STAGES,
  type ConnectedStore,
  type HealthState,
} from "../../dev/mockDatabases";
import type { IngestionOutcome } from "../../dev/dynamicIngest";

/* ------------------------------------------------------------------ helpers */

const KIND_ICON: Record<string, string> = {
  postgres: "M4 7c0 1.66 3.58 3 8 3s8-1.34 8-3-3.58-3-8-3-8 1.34-8 3zM4 7v10c0 1.66 3.58 3 8 3s8-1.34 8-3V7",
  graph: "M8.68 13.34a3 3 0 100-2.68m0 2.68l6.63 3.32m-6.63-6l6.63-3.32",
  storage: "M3 7h18M3 12h18M3 17h18",
  ledger: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
};

const HEALTH_HEX: Record<HealthState, string> = { up: "#5ecf9a", degraded: "#e0a63d", down: "#ff5a3c" };
const HEALTH_UP: Record<HealthState, string> = { up: "LIVE", degraded: "DEGRADED", down: "DOWN" };
const CHECK_HEX: Record<string, string> = { pass: "#5ecf9a", warn: "#e0a63d", fail: "#ff5a3c" };
function integrityHex(pct: number): string {
  return pct >= 99 ? "#5ecf9a" : pct >= 85 ? "#e0a63d" : "#ff5a3c";
}

/* -------------------------------------------------------------------- pane  */

export function DatabasesPane() {
  const stores = useCaseStore((s) => s.connectedStores);
  const recentIngests = useCaseStore((s) => s.recentIngests);
  const ingestedDatasets = useCaseStore((s) => s.ingestedDatasets);
  const openTab = useCaseStore((s) => s.openTab);
  const openIngestModal = useCaseStore((s) => s.openIngestModal);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [datasetSearch, setDatasetSearch] = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);

  const totals = useMemo(() => {
    const up = stores.filter((s) => s.health === "up").length;
    const avgIntegrity = Math.round(stores.reduce((a, s) => a + s.integrity, 0) / stores.length);
    return { up, total: stores.length, avgIntegrity };
  }, [stores]);

  const activeDataset = useMemo(() => {
    if (ingestedDatasets.length === 0) return null;
    if (!selectedDatasetId) return ingestedDatasets[0];
    return ingestedDatasets.find((d) => d.fileId === selectedDatasetId) || ingestedDatasets[0];
  }, [ingestedDatasets, selectedDatasetId]);

  return (
    <div style={{ display: "flex", height: "100%", flexDirection: "column", overflowY: "auto", background: "#060809", color: "#e8edf2", fontFamily: "'Instrument Sans',system-ui,sans-serif", fontSize: 13 }}>
      <style dangerouslySetInnerHTML={{ __html: "@keyframes rvsPulse{0%,100%{opacity:1}50%{opacity:.25}}" }} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid #1b212b", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.01em", color: "#e8edf2" }}>Data Sources & Ingestion</div>
          <div style={{ fontFamily: M_MONO, fontSize: 10, letterSpacing: ".06em", color: "#5c6773", marginTop: 3 }}>
            {totals.up}/{totals.total} STORES LIVE · {totals.avgIntegrity}% AVG INTEGRITY · DYNAMIC REAL-TIME PIPELINE ACTIVE
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={openIngestModal} style={{ ...primaryBtnStyle, height: 34, display: "flex", alignItems: "center", gap: 8 }}>
            ↑ INGEST & SCAN DATASET
          </button>
          <button onClick={() => setShowConnect(true)} style={{ ...outlineBtnStyle, height: 34, display: "flex", alignItems: "center", gap: 8 }}>
            + CONNECT DATABASE
          </button>
        </div>
      </div>

      {/* Connected stores */}
      <div style={{ padding: "20px 24px 10px 24px" }}>
        <div style={{ fontFamily: M_MONO, fontSize: 9, letterSpacing: ".18em", color: "#5c6773", marginBottom: 12 }}>CONNECTED STORES & LIVE REPOSITORIES</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {stores.map((s) => {
            const checks = INTEGRITY_CHECKS.filter((c) => c.storeId === s.id);
            const isOpen = expanded === s.id;
            const hc = HEALTH_HEX[s.health] || "#5ecf9a";
            return (
              <div key={s.id} style={{ border: "1px solid #1b212b", background: "#080b0e" }}>
                <button
                  onClick={() => setExpanded(isOpen ? null : s.id)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#0b0e12")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  style={{ display: "flex", width: "100%", alignItems: "center", gap: 14, padding: "14px 16px", background: "transparent", border: "none", cursor: "pointer", color: "inherit", textAlign: "left", boxSizing: "border-box", fontFamily: "inherit" }}
                >
                  <span style={{ display: "flex", height: 32, width: 32, flexShrink: 0, alignItems: "center", justifyContent: "center", border: "1px solid #1b212b", background: "#0b0e12", color: hc }}>
                    <svg style={{ height: 16, width: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={KIND_ICON[s.kind]} />
                    </svg>
                  </span>
                  <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#e8edf2", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: M_MONO, fontSize: 8, letterSpacing: ".14em", color: hc }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: hc, animation: s.health === "up" ? "rvsPulse 2.4s infinite" : undefined }} />
                        {HEALTH_UP[s.health] || "LIVE"}
                      </span>
                    </span>
                    <span style={{ fontFamily: M_MONO, fontSize: 9, letterSpacing: ".04em", color: "#5c6773", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.role} · {s.location}</span>
                  </span>
                  <span style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontFamily: M_MONO, fontSize: 14, fontWeight: 700, color: integrityHex(s.integrity) }}>{s.integrity}%</span>
                    <span style={{ fontFamily: M_MONO, fontSize: 9, color: "#5c6773" }}>{s.records.toLocaleString()} {s.recordLabel}</span>
                  </span>
                  <span style={{ flexShrink: 0, color: "#5c6773", fontFamily: M_MONO, fontSize: 11, transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
                </button>

                {isOpen && (
                  <div style={{ borderTop: "1px solid #12161d", padding: "12px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontFamily: M_MONO, fontSize: 8, letterSpacing: ".16em", color: "#5c6773", marginBottom: 9 }}>
                      <span>DATA INTEGRITY</span>
                      <span>LAST SYNC {s.lastSync}</span>
                    </div>
                    {checks.map((c) => (
                      <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 9, padding: "3px 0", fontSize: 11 }}>
                        <span style={{ width: 6, height: 6, flexShrink: 0, background: CHECK_HEX[c.state] ?? "#5c6773" }} />
                        <span style={{ color: "#98a4b3" }}>{c.label}</span>
                        <span style={{ marginLeft: "auto", fontFamily: M_MONO, fontSize: 9, color: "#5c6773" }}>{c.detail}</span>
                      </div>
                    ))}
                    {checks.length === 0 && <div style={{ fontFamily: M_MONO, fontSize: 10, color: "#5c6773" }}>No integrity checks registered yet.</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Ingested Datasets Preview Table */}
      {ingestedDatasets.length > 0 && (
        <div style={{ padding: "14px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontFamily: M_MONO, fontSize: 9, letterSpacing: ".18em", color: "#5ecf9a", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#5ecf9a" }} />
              DYNAMIC SCANNED DATASETS ({ingestedDatasets.length} ACTIVE)
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="text"
                value={datasetSearch}
                onChange={(e) => setDatasetSearch(e.target.value)}
                placeholder="Search extracted dataset records..."
                style={{
                  height: 28,
                  background: "#0b0e12",
                  border: "1px solid #1b212b",
                  padding: "0 10px",
                  fontSize: 11,
                  fontFamily: M_MONO,
                  color: "#e8edf2",
                  outline: "none",
                  width: 240,
                }}
              />
              <div style={{ display: "flex", gap: 4 }}>
                {ingestedDatasets.map((ds) => (
                  <button
                    key={ds.fileId}
                    onClick={() => setSelectedDatasetId(ds.fileId)}
                    style={{
                      height: 28,
                      padding: "0 10px",
                      background: activeDataset?.fileId === ds.fileId ? m_hexA(M_AC, 0.15) : "#080b0e",
                      border: `1px solid ${activeDataset?.fileId === ds.fileId ? M_AC : "#1b212b"}`,
                      color: activeDataset?.fileId === ds.fileId ? M_AC : "#98a4b3",
                      fontFamily: M_MONO,
                      fontSize: 10,
                      cursor: "pointer",
                    }}
                  >
                    {ds.fileName} ({ds.rowCount})
                  </button>
                ))}
              </div>
            </div>
          </div>

          {activeDataset && (
            <div style={{ border: "1px solid #1b212b", background: "#080b0e", overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, textAlign: "left" }}>
                <thead>
                  <tr style={{ background: "#0b0e12", borderBottom: "1px solid #1b212b" }}>
                    <th style={{ padding: "8px 12px", fontFamily: M_MONO, fontSize: 9, color: "#5c6773", width: 40 }}>#</th>
                    {activeDataset.headers.map((h) => (
                      <th key={h} style={{ padding: "8px 12px", fontFamily: M_MONO, fontSize: 9, color: M_AC, textTransform: "uppercase" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeDataset.rows
                    .filter((r) => {
                      if (!datasetSearch) return true;
                      return Object.values(r).some((v) => String(v).toLowerCase().includes(datasetSearch.toLowerCase()));
                    })
                    .slice(0, 10)
                    .map((row, rIdx) => (
                      <tr key={rIdx} style={{ borderBottom: "1px solid #12161d" }}>
                        <td style={{ padding: "8px 12px", fontFamily: M_MONO, fontSize: 9, color: "#5c6773" }}>{rIdx + 1}</td>
                        {activeDataset.headers.map((h) => (
                          <td key={h} style={{ padding: "8px 12px", color: "#e8edf2", fontFamily: M_MONO, fontSize: 11 }}>
                            {row[h] || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
              <div style={{ padding: "8px 12px", borderTop: "1px solid #12161d", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, fontFamily: M_MONO, color: "#5c6773" }}>
                <span>Showing top {Math.min(activeDataset.rows.length, 10)} of {activeDataset.rowCount} rows</span>
                <span>SHA-256: {activeDataset.sha256.slice(0, 18)}... · Ingested {activeDataset.ingestedAt}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent ingests */}
      <div style={{ padding: "14px 24px 24px 24px" }}>
        <div style={{ fontFamily: M_MONO, fontSize: 9, letterSpacing: ".18em", color: "#5c6773", marginBottom: 12 }}>RECENT PIPELINE INGESTS & AUDIT LOGS</div>
        <div style={{ border: "1px solid #1b212b", background: "#080b0e" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, textAlign: "left" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1b212b" }}>
                <th style={thStyle}>FILE / ARTIFACT</th>
                <th style={thStyle}>SHA-256 (TAMPER PROOF)</th>
                <th style={thStyle}>ROWS / ENTITIES</th>
                <th style={thStyle}>STATUS</th>
                <th style={thStyle}>SOURCE NODE</th>
                <th style={thStyle}>SIZE</th>
                <th style={thStyle}>TIME</th>
              </tr>
            </thead>
            <tbody>
              {recentIngests.map((r) => {
                const isCommitted = r.status === "COMMITTED";
                const isPending = r.status === "PENDING";
                const stCol = isCommitted ? "#5ecf9a" : isPending ? "#e0a63d" : "#ff5a3c";
                return (
                  <tr key={r.fileId} style={{ borderBottom: "1px solid #12161d" }}>
                    <td style={{ padding: "10px 14px", fontWeight: 600, color: "#e8edf2" }}>{r.fileName}</td>
                    <td style={{ padding: "10px 14px", fontFamily: M_MONO, fontSize: 10, color: "#5c6773" }}>
                      {r.sha256.substring(0, 10)}…{r.sha256.substring(58)}
                    </td>
                    <td style={{ padding: "10px 14px", fontFamily: M_MONO, color: "#e8edf2" }}>{r.rows.toLocaleString()}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: M_MONO, fontSize: 9, letterSpacing: ".1em", color: stCol }}>
                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: stCol }} />
                        {r.status}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", fontFamily: M_MONO, fontSize: 10, color: "#98a4b3" }}>{r.source}</td>
                    <td style={{ padding: "10px 14px", fontFamily: M_MONO, fontSize: 10, color: "#5c6773" }}>{r.size}</td>
                    <td style={{ padding: "10px 14px", fontFamily: M_MONO, fontSize: 10, color: "#5c6773" }}>{r.timeAgo}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showConnect && (
        <ConnectModal
          onClose={() => setShowConnect(false)}
          onAdd={(s) =>
            useCaseStore.setState((st) => ({
              connectedStores: [
                ...st.connectedStores,
                { ...s, records: 0, recordLabel: "records", lastSync: "just now" } as any,
              ],
            }))
          }
        />
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "10px 14px",
  fontFamily: "'Spline Sans Mono',monospace",
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: ".14em",
  color: "#5c6773",
};

function ConnectModal({ onClose, onAdd }: { onClose: () => void; onAdd: (s: ConnectedStore) => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ConnectedStore["kind"]>("postgres");
  const [location, setLocation] = useState("");
  const [role, setRole] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    onAdd({
      id: `store-${Date.now()}`,
      name: name.trim(),
      kind,
      role: role.trim() || "External Investigative DB",
      location: location.trim() || "local network",
      health: "up",
      integrity: 100,
      records: 0,
      recordLabel: "records",
      lastSync: "just now",
    });
    onClose();
  };

  return (
    <Modal title="Connect External Database" onClose={onClose}>
      <Field label="Store Name">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. State CCTNS Node" className={inputCls} style={inputStyle} />
      </Field>
      <Field label="Store Kind">
        <select value={kind} onChange={(e) => setKind(e.target.value as ConnectedStore["kind"])} className={inputCls} style={inputStyle}>
          <option value="postgres">PostgreSQL / Relational</option>
          <option value="graph">Neo4j / Graph</option>
          <option value="storage">Object Storage</option>
          <option value="ledger">Ledger / Hyperledger Fabric</option>
        </select>
      </Field>
      <Field label="Endpoint URI">
        <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="postgresql://user:pass@host:5432/db" className={inputCls} style={inputStyle} />
      </Field>
      <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onClose} style={ghostBtnStyle}>CANCEL</button>
        <button onClick={submit} disabled={!name.trim()} style={{ ...primaryBtnStyle, opacity: !name.trim() ? 0.4 : 1 }}>CONNECT</button>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- shared   */

const M_AC = "#e8c15a";
const m_hexA = (h: string, a: number) => h + Math.round(a * 255).toString(16).padStart(2, "0");
const M_MONO = "'Spline Sans Mono',monospace";

const inputCls = "w-full font-sans";
const inputStyle: React.CSSProperties = {
  height: 34,
  width: "100%",
  background: "#0b0e12",
  border: "1px solid #1b212b",
  padding: "0 10px",
  fontSize: 12,
  color: "#e8edf2",
  outline: "none",
  boxSizing: "border-box",
};
const primaryBtnStyle: React.CSSProperties = {
  height: 32,
  padding: "0 14px",
  background: m_hexA(M_AC, 0.1),
  border: `1px solid ${m_hexA(M_AC, 0.35)}`,
  color: M_AC,
  fontFamily: M_MONO,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: ".1em",
  cursor: "pointer",
};
const outlineBtnStyle: React.CSSProperties = {
  height: 32,
  padding: "0 12px",
  background: "#0b0e12",
  border: "1px solid #1b212b",
  color: "#98a4b3",
  fontFamily: M_MONO,
  fontSize: 11,
  letterSpacing: ".08em",
  cursor: "pointer",
};
const ghostBtnStyle: React.CSSProperties = {
  height: 32,
  padding: "0 12px",
  background: "transparent",
  border: "none",
  color: "#5c6773",
  fontFamily: M_MONO,
  fontSize: 11,
  letterSpacing: ".08em",
  cursor: "pointer",
};

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(6,8,9,.8)", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 560, maxWidth: "100%", border: "1px solid #1b212b", background: "#080b0e", padding: 18, boxShadow: "0 20px 60px rgba(0,0,0,.7)", fontFamily: "'Instrument Sans',system-ui,sans-serif" }}
      >
        <div style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0, fontFamily: M_MONO, fontSize: 11, fontWeight: 700, letterSpacing: ".16em", color: M_AC }}>
            {title.toUpperCase()}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#5c6773", cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <label style={{ marginBottom: 5, display: "block", fontFamily: M_MONO, fontSize: 9, letterSpacing: ".12em", color: "#98a4b3" }}>
        {label.toUpperCase()}
      </label>
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  const color = tone.includes("success") ? "#5ecf9a" : tone.includes("warning") ? "#ff5a3c" : tone.includes("accent") ? M_AC : "#e8edf2";
  return (
    <div style={{ border: "1px solid #1b212b", background: "#0b0e12", padding: "8px 4px" }}>
      <div style={{ fontFamily: M_MONO, fontSize: 14, fontWeight: 700, color }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 9, color: "#5c6773", marginTop: 2 }}>{label}</div>
    </div>
  );
}
