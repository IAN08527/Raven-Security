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

/* ------------------------------------------------------------------ helpers */

const HEALTH_DOT: Record<HealthState, string> = {
  up: "bg-pd-success",
  degraded: "bg-pd-warning",
  down: "bg-pd-danger",
};
const HEALTH_TEXT: Record<HealthState, string> = {
  up: "text-pd-success",
  degraded: "text-pd-warning",
  down: "text-pd-danger",
};
const HEALTH_LABEL: Record<HealthState, string> = {
  up: "Live",
  degraded: "Degraded",
  down: "Down",
};

const KIND_ICON: Record<ConnectedStore["kind"], string> = {
  postgres: "M4 7c0 1.66 3.58 3 8 3s8-1.34 8-3-3.58-3-8-3-8 1.34-8 3zM4 7v10c0 1.66 3.58 3 8 3s8-1.34 8-3V7",
  graph: "M8.68 13.34a3 3 0 100-2.68m0 2.68l6.63 3.32m-6.63-6l6.63-3.32",
  storage: "M3 7h18M3 12h18M3 17h18",
  ledger: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
};

function integrityColor(pct: number): string {
  if (pct >= 99) return "text-pd-success";
  if (pct >= 85) return "text-pd-warning";
  return "text-pd-danger";
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
    <div className="flex h-full flex-col overflow-y-auto bg-pd-base p-4 text-pd-text-primary">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-pd-border pb-4">
        <div>
          <h1 className="text-pd-lg font-semibold text-pd-text-primary">Data Sources</h1>
          <p className="text-pd-xs text-pd-text-tertiary">
            {totals.up}/{totals.total} stores live · {totals.avgIntegrity}% avg integrity · all
            ingest routes through the upload pipeline
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowUpload(true)}
            style={{ ...outlineBtnStyle, height: 34, display: "flex", alignItems: "center", gap: 8 }}
          >
            ↑ UPLOAD CSV / PDF
          </button>
          <button
            onClick={() => setShowConnect(true)}
            style={{ ...primaryBtnStyle, height: 34, display: "flex", alignItems: "center", gap: 8 }}
          >
            + CONNECT DATABASE
          </button>
        </div>
      </div>

      {/* Connected stores */}
      <section className="mt-4">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-pd-text-tertiary">
          Connected Databases
        </h2>
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
          {stores.map((s) => {
            const checks = INTEGRITY_CHECKS.filter((c) => c.storeId === s.id);
            const isOpen = expanded === s.id;
            return (
              <div
                key={s.id}
                className="rounded-sm border border-pd-border bg-pd-surface transition-colors hover:border-pd-border"
              >
                <button
                  onClick={() => setExpanded(isOpen ? null : s.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-pd-border bg-pd-elevated text-pd-accent">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={KIND_ICON[s.kind]} />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-pd-sm font-medium text-pd-text-primary">{s.name}</span>
                      <span className="flex items-center gap-1 text-[10px]">
                        <span className={`h-1.5 w-1.5 rounded-full ${HEALTH_DOT[s.health]} ${s.health === "up" ? "animate-pulse" : ""}`} />
                        <span className={HEALTH_TEXT[s.health]}>{HEALTH_LABEL[s.health]}</span>
                      </span>
                    </div>
                    <div className="truncate text-[10px] text-pd-text-tertiary">
                      {s.role} · {s.location}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`font-mono text-pd-sm font-semibold ${integrityColor(s.integrity)}`}>
                      {s.integrity}%
                    </div>
                    <div className="text-[10px] text-pd-text-tertiary">
                      {s.records.toLocaleString()} {s.recordLabel}
                    </div>
                  </div>
                  <svg
                    className={`h-4 w-4 shrink-0 text-pd-text-tertiary transition-transform ${isOpen ? "rotate-90" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="border-t border-pd-border/60 px-3 py-2">
                    <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-pd-text-tertiary">
                      <span>Data Integrity</span>
                      <span>last sync {s.lastSync}</span>
                    </div>
                    <ul className="space-y-1">
                      {checks.map((c) => (
                        <li key={c.label} className="flex items-center gap-2 text-pd-xs">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              c.state === "pass" ? "bg-pd-success" : c.state === "warn" ? "bg-pd-warning" : "bg-pd-danger"
                            }`}
                          />
                          <span className="text-pd-text-secondary">{c.label}</span>
                          <span className="ml-auto text-pd-text-tertiary">{c.detail}</span>
                        </li>
                      ))}
                      {checks.length === 0 && (
                        <li className="text-pd-xs text-pd-text-tertiary">No integrity checks registered yet.</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Pipeline reference */}
      <section className="mt-5">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-pd-text-tertiary">
          Data Upload Pipeline — stores everything in sequence
        </h2>
        <div className="flex flex-wrap items-center gap-1.5 rounded-sm border border-pd-border bg-pd-surface p-3">
          {PIPELINE_STAGES.map((st, i) => (
            <div key={st.id} className="flex items-center gap-1.5">
              <div className="rounded-sm border border-pd-border bg-pd-elevated px-2.5 py-1.5">
                <div className="text-pd-xs font-medium text-pd-text-primary">{st.label}</div>
                <div className="text-[10px] text-pd-text-tertiary">{st.detail}</div>
              </div>
              {i < PIPELINE_STAGES.length - 1 && (
                <svg className="h-3 w-3 shrink-0 text-pd-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </div>
          ))}
        </div>
      </section>

      {showConnect && <ConnectDatabaseModal onClose={() => setShowConnect(false)} onAdd={addStore} />}
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}
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
        <p className="mt-1 text-[10px] text-pd-text-tertiary">
          Credentials are never entered here — set them in <span className="font-mono">.env</span>.
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
        <p className="mt-1 text-[10px] text-pd-text-tertiary">
          Maps to <span className="font-mono text-pd-text-secondary">{cat.source}</span> ·{" "}
          <span className="font-mono text-pd-text-secondary">{cat.target}</span>
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
        <p className="mt-1 text-[10px] text-pd-text-tertiary">
          Routes into <span className="font-mono text-pd-text-secondary">{cat.target}</span>. Unknown
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
