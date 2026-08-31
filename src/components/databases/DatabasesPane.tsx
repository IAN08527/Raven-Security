import { useMemo, useState } from "react";
import {
  CONNECTED_STORES,
  INTEGRITY_CHECKS,
  DATA_CATEGORIES,
  PIPELINE_STAGES,
  simulateIngest,
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
            className="flex h-8 items-center gap-1.5 rounded-sm border border-pd-border bg-pd-surface px-3 text-pd-sm font-medium text-pd-text-secondary transition-colors hover:border-pd-accent hover:text-pd-accent"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload CSV / PDF
          </button>
          <button
            onClick={() => setShowConnect(true)}
            className="flex h-8 items-center gap-1.5 rounded-sm bg-pd-accent px-3 text-pd-sm font-medium text-pd-base shadow-sm transition-colors hover:bg-pd-accent-hover"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Connect Database
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
          className={`${inputCls} font-mono`}
        />
        <p className="mt-1 text-[10px] text-pd-text-tertiary">
          Credentials are never entered here — set them in <span className="font-mono">.env</span>.
          This registers the endpoint only.
        </p>
      </Field>

      <Field label="Data category">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
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
          className="flex h-8 items-center gap-1.5 rounded-sm border border-pd-border bg-pd-elevated px-3 text-pd-sm text-pd-text-secondary transition-colors hover:border-pd-accent hover:text-pd-accent disabled:opacity-40"
        >
          {testState === "testing" ? "Testing…" : "Test connection"}
        </button>
        {testState === "ok" && <span className="text-pd-xs text-pd-success">● Connection OK</span>}
        {testState === "fail" && <span className="text-pd-xs text-pd-danger">● Unreachable — check URL</span>}

        <div className="ml-auto flex items-center gap-2">
          <button onClick={onClose} className="h-8 rounded-sm px-3 text-pd-sm text-pd-text-tertiary hover:text-pd-text-primary">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="h-8 rounded-sm bg-pd-accent px-3 text-pd-sm font-medium text-pd-base hover:bg-pd-accent-hover disabled:opacity-40"
          >
            Add source
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ upload modal  */

function UploadModal({ onClose }: { onClose: () => void }) {
  const [fileName, setFileName] = useState("");
  const [category, setCategory] = useState(DATA_CATEGORIES[0].id);
  const [running, setRunning] = useState(false);
  const [activeStage, setActiveStage] = useState(-1);
  const [result, setResult] = useState<PipelineResult | null>(null);

  const cat = DATA_CATEGORIES.find((c) => c.id === category)!;

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFileName(f.name);
      setResult(null);
      setActiveStage(-1);
    }
  };

  const run = () => {
    if (!fileName || running) return;
    setRunning(true);
    setResult(null);
    setActiveStage(0);
    let i = 0;
    const tick = window.setInterval(() => {
      i += 1;
      if (i >= PIPELINE_STAGES.length) {
        window.clearInterval(tick);
        setResult(simulateIngest(fileName, category));
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
        <label className="flex cursor-pointer items-center justify-between rounded-sm border border-dashed border-pd-border bg-pd-elevated px-3 py-3 text-pd-sm text-pd-text-secondary transition-colors hover:border-pd-accent">
          <span className={fileName ? "text-pd-text-primary" : "text-pd-text-tertiary"}>
            {fileName || "Choose a .csv or .pdf file…"}
          </span>
          <span className="rounded-sm border border-pd-border bg-pd-surface px-2 py-1 text-pd-xs">Browse</span>
          <input type="file" accept=".csv,.pdf" className="hidden" onChange={onPick} />
        </label>
      </Field>

      <Field label="Data category">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls} disabled={running}>
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
        <div className="mt-3 space-y-1.5 rounded-sm border border-pd-border bg-pd-elevated p-3">
          {PIPELINE_STAGES.map((st, i) => {
            const done = i < activeStage || (!running && result !== null);
            const current = running && i === activeStage;
            return (
              <div key={st.id} className="flex items-center gap-2 text-pd-xs">
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] ${
                    done ? "bg-pd-success text-pd-base" : current ? "bg-pd-accent text-pd-base" : "border border-pd-border text-pd-text-tertiary"
                  }`}
                >
                  {done ? "✓" : current ? "…" : i + 1}
                </span>
                <span className={done || current ? "text-pd-text-primary" : "text-pd-text-tertiary"}>{st.label}</span>
                <span className="ml-auto text-pd-text-tertiary">{st.detail}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="mt-3 rounded-sm border border-pd-border bg-pd-surface p-3 text-pd-xs">
          <div className="mb-2 flex items-center gap-2 font-medium text-pd-success">
            <span>✓ Stored in sequence</span>
            <span className="text-pd-text-tertiary">· {result.fileName}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Detected" value={result.rowsDetected} tone="text-pd-text-primary" />
            <Stat label="Mapped → schema" value={result.rowsMapped} tone="text-pd-success" />
            <Stat label="Isolated" value={result.rowsIsolated} tone="text-pd-warning" />
          </div>
          {result.unmapped.length > 0 && (
            <div className="mt-2 border-t border-pd-border/60 pt-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-pd-text-tertiary">
                Isolated — unmapped fields (held for review)
              </div>
              <ul className="space-y-0.5">
                {result.unmapped.map((u) => (
                  <li key={u.column} className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-pd-warning">{u.column}</span>
                    <span className="text-pd-text-tertiary">e.g. {u.sample}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button onClick={onClose} className="h-8 rounded-sm px-3 text-pd-sm text-pd-text-tertiary hover:text-pd-text-primary">
          Close
        </button>
        <button
          onClick={run}
          disabled={!fileName || running}
          className="h-8 rounded-sm bg-pd-accent px-3 text-pd-sm font-medium text-pd-base hover:bg-pd-accent-hover disabled:opacity-40"
        >
          {running ? "Running pipeline…" : result ? "Run again" : "Run pipeline"}
        </button>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------- shared   */

const inputCls =
  "h-8.5 w-full rounded-sm border border-pd-border bg-pd-surface px-2.5 text-pd-sm text-pd-text-primary placeholder:text-pd-text-tertiary focus:border-pd-accent focus:outline-none";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-pd-base/70 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] max-w-full rounded-md border border-pd-border bg-pd-surface p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-pd-base font-semibold text-pd-text-primary">{title}</h2>
          <button className="text-pd-text-tertiary hover:text-pd-danger" onClick={onClose}>
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
    <div className="mt-3 first:mt-0">
      <label className="mb-1 block text-pd-xs font-medium text-pd-text-secondary">{label}</label>
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-sm border border-pd-border bg-pd-elevated py-1.5">
      <div className={`font-mono text-pd-base font-semibold ${tone}`}>{value.toLocaleString()}</div>
      <div className="text-[10px] text-pd-text-tertiary">{label}</div>
    </div>
  );
}
