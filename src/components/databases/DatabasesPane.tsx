import { useMemo, useState } from "react";
import {
  CONNECTED_STORES,
  INTEGRITY_CHECKS,
  DATA_CATEGORIES,
  PIPELINE_STAGES,
  runIngest,
  type ConnectedStore,
  type HealthState,
  type PipelineResult,
} from "../../dev/mockDatabases";
import { DynamicIngestModal } from "../pipeline/DynamicIngestModal";


/* ------------------------------------------------------------------ helpers */

const KIND_ICON: Record<ConnectedStore["kind"], string> = {
  postgres: "M4 7c0 1.66 3.58 3 8 3s8-1.34 8-3-3.58-3-8-3-8 1.34-8 3zM4 7v10c0 1.66 3.58 3 8 3s8-1.34 8-3V7",
  graph: "M8.68 13.34a3 3 0 100-2.68m0 2.68l6.63 3.32m-6.63-6l6.63-3.32",
  storage: "M3 7h18M3 12h18M3 17h18",
  ledger: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
};

// RAVEN-refactor theme color maps (inline)
const HEALTH_HEX: Record<HealthState, string> = { up: "#5ecf9a", degraded: "#e0a63d", down: "#ff5a3c" };
const HEALTH_UP: Record<HealthState, string> = { up: "LIVE", degraded: "DEGRADED", down: "DOWN" };
const CHECK_HEX: Record<string, string> = { pass: "#5ecf9a", warn: "#e0a63d", fail: "#ff5a3c" };
function integrityHex(pct: number): string {
  return pct >= 99 ? "#5ecf9a" : pct >= 85 ? "#e0a63d" : "#ff5a3c";
}

/* -------------------------------------------------------------------- pane  */

export function DatabasesPane() {
  const [stores, setStores] = useState<ConnectedStore[]>(CONNECTED_STORES);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const totals = useMemo(() => {
    const up = stores.filter((s) => s.health === "up").length;
    const avgIntegrity = Math.round(stores.reduce((a, s) => a + s.integrity, 0) / stores.length);
    return { up, total: stores.length, avgIntegrity };
  }, [stores]);

  const addStore = (store: ConnectedStore) => setStores((prev) => [...prev, store]);

  return (
    <div style={{ display: "flex", height: "100%", flexDirection: "column", overflowY: "auto", background: "#060809", color: "#e8edf2", fontFamily: "'Instrument Sans',system-ui,sans-serif", fontSize: 13 }}>
      <style dangerouslySetInnerHTML={{ __html: "@keyframes rvsPulse{0%,100%{opacity:1}50%{opacity:.25}}" }} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid #1b212b", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.01em", color: "#e8edf2" }}>Data Sources</div>
          <div style={{ fontFamily: M_MONO, fontSize: 10, letterSpacing: ".06em", color: "#5c6773", marginTop: 3 }}>
            {totals.up}/{totals.total} STORES LIVE · {totals.avgIntegrity}% AVG INTEGRITY · ALL INGEST VIA UPLOAD PIPELINE
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setShowUpload(true)} style={{ ...outlineBtnStyle, height: 34, display: "flex", alignItems: "center", gap: 8 }}>
            ↑ UPLOAD CSV / PDF
          </button>
          <button onClick={() => setShowConnect(true)} style={{ ...primaryBtnStyle, height: 34, display: "flex", alignItems: "center", gap: 8 }}>
            + CONNECT DATABASE
          </button>
        </div>
      </div>

      {/* Connected stores */}
      <div style={{ padding: "20px 24px" }}>
        <div style={{ fontFamily: M_MONO, fontSize: 9, letterSpacing: ".18em", color: "#5c6773", marginBottom: 12 }}>CONNECTED STORES</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {stores.map((s) => {
            const checks = INTEGRITY_CHECKS.filter((c) => c.storeId === s.id);
            const isOpen = expanded === s.id;
            const hc = HEALTH_HEX[s.health];
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
                        {HEALTH_UP[s.health]}
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

      {/* Pipeline reference */}
      <div style={{ padding: "4px 24px 26px" }}>
        <div style={{ fontFamily: M_MONO, fontSize: 9, letterSpacing: ".18em", color: "#5c6773", marginBottom: 12 }}>UPLOAD PIPELINE · STORES EVERYTHING IN SEQUENCE</div>
        <div style={{ display: "flex", alignItems: "stretch", border: "1px solid #1b212b", background: "#080b0e" }}>
          {PIPELINE_STAGES.map((st, i) => (
            <div key={st.id} style={{ flex: 1, display: "flex", alignItems: "center", minWidth: 0 }}>
              <div style={{ flex: 1, padding: "14px 16px", minWidth: 0 }}>
                <div style={{ fontFamily: M_MONO, fontSize: 10, fontWeight: 700, color: M_AC, letterSpacing: ".06em" }}>{"0" + (i + 1)}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#e8edf2", marginTop: 4 }}>{st.label}</div>
                <div style={{ fontFamily: M_MONO, fontSize: 9, color: "#5c6773", marginTop: 3, lineHeight: 1.5 }}>{st.detail}</div>
              </div>
              {i < PIPELINE_STAGES.length - 1 && <span style={{ color: "#232b37", fontSize: 14, paddingRight: 2 }}>›</span>}
            </div>
          ))}
        </div>
      </div>

      {showConnect && <ConnectDatabaseModal onClose={() => setShowConnect(false)} onAdd={addStore} />}
      {showUpload && <DynamicIngestModal onClose={() => setShowUpload(false)} />}
    </div>
  );
}

/* --------------------------------------------------------- connect DB modal */

function ConnectDatabaseModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (s: ConnectedStore) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState(DATA_CATEGORIES[0].id);
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "fail">("idle");

  const cat = DATA_CATEGORIES.find((c) => c.id === category)!;
  const canSubmit = url.trim().length > 0 && testState === "ok";

  const runTest = () => {
    setTestState("testing");
    // Mock: a URL that parses + has a host "connects"; otherwise fail.
    window.setTimeout(() => {
      const looksValid = /:\/\/.+/.test(url.trim());
      setTestState(looksValid ? "ok" : "fail");
    }, 700);
  };

  const submit = () => {
    if (!canSubmit) return;
    let host = "external source";
    try {
      host = new URL(url).host;
    } catch {
      /* keep default */
    }
    onAdd({
      id: `ext-${Date.now()}`,
      name: name.trim() || host,
      kind: "postgres",
      role: `${cat.label} source → ${cat.target}`,
      location: host,
      health: "up",
      integrity: 100,
      records: 0,
      recordLabel: "rows · pending first sync",
      lastSync: "never",
    });
    onClose();
  };

  return (
    <Modal title="Connect Database" onClose={onClose}>
      <Field label="Display name (optional)">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. VAHAN Regional Registry"
          className={inputCls}
          style={inputStyle}
        />
      </Field>

      <Field label="Connection URL">
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setTestState("idle");
          }}
          placeholder="postgresql://host:5432/db  ·  https://api.source.gov.in"
          className={inputCls}
          style={{ ...inputStyle, fontFamily: M_MONO }}
        />
        <p style={{ marginTop: 4, fontSize: 10, color: "#5c6773" }}>
          Credentials are never entered here — set them in <span style={{ fontFamily: M_MONO }}>.env</span>.
          This registers the endpoint only.
        </p>
      </Field>

      <Field label="Data category">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls} style={inputStyle}>
          {DATA_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} — {c.hint}
            </option>
          ))}
        </select>
        <p style={{ marginTop: 4, fontSize: 10, color: "#5c6773" }}>
          Maps to <span style={{ fontFamily: M_MONO, color: "#98a4b3" }}>{cat.source}</span> ·{" "}
          <span style={{ fontFamily: M_MONO, color: "#98a4b3" }}>{cat.target}</span>
        </p>
      </Field>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={runTest}
          disabled={url.trim().length === 0 || testState === "testing"}
          style={{ ...outlineBtnStyle, display: "flex", alignItems: "center", gap: 6, opacity: url.trim().length === 0 || testState === "testing" ? 0.4 : 1 }}
        >
          {testState === "testing" ? "TESTING…" : "TEST CONNECTION"}
        </button>
        {testState === "ok" && <span style={{ fontFamily: M_MONO, fontSize: 10, color: "#5ecf9a" }}>● CONNECTION OK</span>}
        {testState === "fail" && <span style={{ fontFamily: M_MONO, fontSize: 10, color: "#ff5a3c" }}>● UNREACHABLE — CHECK URL</span>}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={onClose} style={ghostBtnStyle}>CANCEL</button>
          <button onClick={submit} disabled={!canSubmit} style={{ ...primaryBtnStyle, opacity: canSubmit ? 1 : 0.4 }}>
            ADD SOURCE
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ upload modal  */

function UploadModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState(DATA_CATEGORIES[0].id);
  const [running, setRunning] = useState(false);
  const [activeStage, setActiveStage] = useState(-1);
  const [result, setResult] = useState<PipelineResult | null>(null);

  const cat = DATA_CATEGORIES.find((c) => c.id === category)!;
  const fileName = file?.name ?? "";

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setResult(null);
      setActiveStage(-1);
    }
  };

  const run = async () => {
    if (!file || running) return;
    setRunning(true);
    setResult(null);
    setActiveStage(0);

    // Read the real CSV text up front (PDFs are ingested as a document stub).
    const isCsv = /\.csv$/i.test(file.name);
    let csvText: string | undefined;
    if (isCsv) {
      try {
        csvText = await file.text();
      } catch {
        csvText = "";
      }
    }

    let i = 0;
    const tick = window.setInterval(() => {
      i += 1;
      if (i >= PIPELINE_STAGES.length) {
        window.clearInterval(tick);
        setResult(runIngest(file.name, category, csvText));
        setRunning(false);
        setActiveStage(PIPELINE_STAGES.length);
      } else {
        setActiveStage(i);
      }
    }, 500);
  };

  return (
    <Modal title="Upload to Ingest Pipeline" onClose={onClose}>
      <Field label="File (CSV or PDF)">
        <label style={{ display: "flex", cursor: "pointer", alignItems: "center", justifyContent: "space-between", border: "1px dashed #1b212b", background: "#0b0e12", padding: "12px", fontSize: 12 }}>
          <span style={{ color: fileName ? "#e8edf2" : "#5c6773" }}>
            {fileName || "Choose a .csv or .pdf file…"}
          </span>
          <span style={{ border: "1px solid #1b212b", background: "#080b0e", padding: "4px 8px", fontFamily: M_MONO, fontSize: 10, letterSpacing: ".08em", color: "#98a4b3" }}>BROWSE</span>
          <input type="file" accept=".csv,.pdf" className="hidden" onChange={onPick} />
        </label>
      </Field>

      <Field label="Data category">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls} style={inputStyle} disabled={running}>
          {DATA_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} — {c.hint}
            </option>
          ))}
        </select>
        <p style={{ marginTop: 4, fontSize: 10, color: "#5c6773" }}>
          Routes into <span style={{ fontFamily: M_MONO, color: "#98a4b3" }}>{cat.target}</span>. Unknown
          columns are isolated for review.
        </p>
      </Field>

      {/* Pipeline progress */}
      {activeStage >= 0 && (
        <div style={{ marginTop: 12, border: "1px solid #1b212b", background: "#0b0e12", padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {PIPELINE_STAGES.map((st, i) => {
            const done = i < activeStage || (!running && result !== null);
            const current = running && i === activeStage;
            return (
              <div key={st.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                <span
                  style={{
                    display: "flex",
                    height: 16,
                    width: 16,
                    flexShrink: 0,
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9,
                    fontFamily: M_MONO,
                    background: done ? "#5ecf9a" : current ? M_AC : "transparent",
                    color: done || current ? "#060809" : "#5c6773",
                    border: done || current ? "none" : "1px solid #1b212b",
                  }}
                >
                  {done ? "✓" : current ? "…" : i + 1}
                </span>
                <span style={{ color: done || current ? "#e8edf2" : "#5c6773" }}>{st.label}</span>
                <span style={{ marginLeft: "auto", fontFamily: M_MONO, fontSize: 9, color: "#5c6773" }}>{st.detail}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{ marginTop: 12, border: "1px solid #1b212b", background: "#060809", padding: 12, fontSize: 11 }}>
          <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "#5ecf9a" }}>
            <span>✓ Stored in sequence</span>
            <span style={{ color: "#5c6773" }}>· {result.fileName} · parsed as {result.kind.toUpperCase()}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" }}>
            <Stat label="Rows detected" value={result.rowsDetected} tone="text-pd-text-primary" />
            <Stat label={result.kind === "csv" ? "Columns mapped" : "Docs mapped"} value={result.mappedCount} tone="text-pd-success" />
            <Stat label={result.kind === "csv" ? "Columns isolated" : "Docs isolated"} value={result.isolatedCount} tone="text-pd-warning" />
          </div>

          {result.mappedFields.length > 0 && (
            <div style={{ marginTop: 8, borderTop: "1px solid #12161d", paddingTop: 8 }}>
              <div style={{ marginBottom: 4, fontFamily: M_MONO, fontSize: 9, letterSpacing: ".12em", color: "#5c6773" }}>MAPPED → {cat.target}</div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 2 }}>
                {result.mappedFields.map((m) => (
                  <li key={m.header} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: M_MONO, fontSize: 11 }}>
                    <span style={{ color: "#98a4b3" }}>{m.header}</span>
                    <span style={{ color: "#5c6773" }}>→</span>
                    <span style={{ color: "#5ecf9a" }}>{m.target}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.unmapped.length > 0 && (
            <div style={{ marginTop: 8, borderTop: "1px solid #12161d", paddingTop: 8 }}>
              <div style={{ marginBottom: 4, fontFamily: M_MONO, fontSize: 9, letterSpacing: ".12em", color: "#5c6773" }}>ISOLATED — UNMAPPED FIELDS (HELD FOR REVIEW)</div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 2 }}>
                {result.unmapped.map((u) => (
                  <li key={u.column} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: M_MONO, fontSize: 11 }}>
                    <span style={{ color: "#e0a63d" }}>{u.column}</span>
                    <span style={{ color: "#5c6773" }}>e.g. {u.sample}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.kind === "csv" && result.mappedCount === 0 && (
            <p style={{ marginTop: 8, fontSize: 11, color: "#e0a63d" }}>
              No columns matched {cat.target} — whole file isolated for review.
            </p>
          )}
        </div>
      )}

      <div style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={onClose} style={ghostBtnStyle}>CLOSE</button>
        <button onClick={run} disabled={!fileName || running} style={{ ...primaryBtnStyle, opacity: !fileName || running ? 0.4 : 1 }}>
          {running ? "RUNNING PIPELINE…" : result ? "RUN AGAIN" : "RUN PIPELINE"}
        </button>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- shared   */

// ── RAVEN-refactor theme (match RavenShell) ──
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
      style={{ position: "absolute", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(6,8,9,.75)", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 520, maxWidth: "100%", border: "1px solid #1b212b", background: "#080b0e", padding: 18, boxShadow: "0 20px 60px rgba(0,0,0,.6)", fontFamily: "'Instrument Sans',system-ui,sans-serif" }}
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
  const color = tone.includes("success") ? "#5ecf9a" : tone.includes("warning") ? "#e0a63d" : "#e8edf2";
  return (
    <div style={{ border: "1px solid #1b212b", background: "#0b0e12", padding: "8px 0" }}>
      <div style={{ fontFamily: M_MONO, fontSize: 14, fontWeight: 700, color }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 9, color: "#5c6773" }}>{label}</div>
    </div>
  );
}
