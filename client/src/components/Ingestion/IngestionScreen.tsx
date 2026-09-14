import { useRef, useState } from "react";
import {
  INGEST_STAGES,
  fetchFile,
  stageStates,
  uploadFile,
  verifyFile,
  type FileDetail,
  type FileVerify,
  type StageState,
} from "../../lib/files";

// Document Ingestion (screen 06, design §11). Operational queue, not a
// marketing upload page: dropzone, case + document-type + provenance
// selectors, per-file progress, six §4.3 stage indicators, recent table,
// detail panel wired to GET /files/{id} and /verify (FR-7.2).
//
// Honest wiring: MIME comes from the server on upload (FR-1.1) — the UI
// shows the file extension only as an unverified hint until then. The
// upload POST and the recent-ingestions list have no server endpoint in
// this build phase, so attempts surface the real server answer (failed
// stage with reason + retry, FR-1.4) and the table shows its empty state.
// Nothing here invents rows or bytes.

const ACCEPTED = [".pdf", ".jpg", ".jpeg", ".png", ".csv", ".json", ".xlsx"];
const MAX_BYTES = 200 * 1024 * 1024;

const SOURCE_NODES = ["CCTNS", "CFCFRMS", "ICJS", "VAHAN", "NAFIS", "TELECOM", "PUBLIC_DATASET", "MANUAL"] as const;

interface UploadRow {
  key: string;
  name: string;
  size: number;
  progress: number;
  error: string | null;
  detail: FileDetail | null;
}

function StageDots({ states }: { states: StageState[] }): JSX.Element {
  return (
    <ol className="flex items-center gap-1" aria-label="Ingest stages">
      {INGEST_STAGES.map((stage, index) => (
        <li key={stage} title={stage} className="flex items-center gap-1">
          <span
            aria-label={`${stage}: ${states[index]}`}
            className={
              states[index] === "done"
                ? "inline-block h-2 w-2 rounded-full bg-green-500"
                : states[index] === "active"
                  ? "inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500"
                  : states[index] === "failed"
                    ? "inline-block h-2 w-2 rounded-full bg-red-500"
                    : "inline-block h-2 w-2 rounded-full bg-neutral-600"
            }
          />
          {index < INGEST_STAGES.length - 1 ? <span className="h-px w-2 bg-neutral-700" /> : null}
        </li>
      ))}
    </ol>
  );
}

export function IngestionScreen({ onOpenReview }: { onOpenReview: (caseId: string) => void }): JSX.Element {
  const [caseId, setCaseId] = useState("");
  const [documentType, setDocumentType] = useState("auto");
  const [provenance, setProvenance] = useState("collected");
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [detail, setDetail] = useState<FileDetail | null>(null);
  const [verifyResult, setVerifyResult] = useState<FileVerify | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [lookupId, setLookupId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function queue(files: FileList | File[]): void {
    const list = Array.from(files);
    for (const file of list) {
      const lower = file.name.toLowerCase();
      const accepted = ACCEPTED.some((ext) => lower.endsWith(ext));
      const key = `${file.name}-${file.size}-${Date.now()}`;
      if (!accepted) {
        setUploads((rows) => [...rows, { key, name: file.name, size: file.size, progress: 0, error: `Rejected: unsupported type (FR-1.1). Accepted: ${ACCEPTED.join(", ")}.`, detail: null }]);
        continue;
      }
      if (file.size > MAX_BYTES) {
        setUploads((rows) => [...rows, { key, name: file.name, size: file.size, progress: 0, error: "Rejected: over the 200MB per-file limit.", detail: null }]);
        continue;
      }
      if (!caseId) {
        setUploads((rows) => [...rows, { key, name: file.name, size: file.size, progress: 0, error: "Queued: enter an assigned case id first.", detail: null }]);
        continue;
      }
      const row: UploadRow = { key, name: file.name, size: file.size, progress: 0, error: null, detail: null };
      setUploads((rows) => [...rows, row]);
      const handle = uploadFile(
        caseId,
        file,
        { documentType, provenance },
        (progress) => setUploads((rows) => rows.map((item) => (item.key === key ? { ...item, progress } : item))),
      );
      handle.done.then(
        (fileDetail) => setUploads((rows) => rows.map((item) => (item.key === key ? { ...item, progress: 100, detail: fileDetail } : item))),
        (err: Error) => setUploads((rows) => rows.map((item) => (item.key === key ? { ...item, error: err.message } : item))),
      );
    }
  }

  async function lookup(): Promise<void> {
    setDetailError(null);
    setDetail(null);
    setVerifyResult(null);
    if (!lookupId) return;
    try {
      setDetail(await fetchFile(lookupId));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Lookup failed.");
    }
  }

  async function verify(): Promise<void> {
    if (!detail) return;
    try {
      setVerifyResult(await verifyFile(detail.file.id));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Verification failed.");
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-2xl text-neutral-50">Document Ingestion</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop files here or browse"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter") inputRef.current?.click();
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            queue(event.dataTransfer.files);
          }}
          className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 border border-dashed border-neutral-600 bg-neutral-900 p-6 text-sm text-neutral-300"
        >
          <span>Drop files here or click to browse</span>
          <span className="text-xs text-neutral-500">PDF, JPG, PNG, CSV, JSON, XLSX · max 200MB per file</span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED.join(",")}
            className="hidden"
            onChange={(event) => {
              if (event.target.files) queue(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        <div className="flex flex-col gap-2 border border-neutral-800 bg-neutral-900 p-3">
          <h2 className="text-sm font-semibold text-neutral-100">Ingestion Settings</h2>
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            Case id (assigned)
            <input
              aria-label="Case id"
              className="border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100"
              placeholder="00000000-0000-0000-0000-000000000000"
              value={caseId}
              onChange={(event) => setCaseId(event.target.value.trim())}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            Document type
            <select
              aria-label="Document type"
              className="border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100"
              value={documentType}
              onChange={(event) => setDocumentType(event.target.value)}
            >
              <option value="auto">Auto-detect (default)</option>
              {SOURCE_NODES.map((node) => (
                <option key={node} value={node}>{node}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-400">
            Provenance
            <select
              aria-label="Provenance"
              className="border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100"
              value={provenance}
              onChange={(event) => setProvenance(event.target.value)}
            >
              <option value="benchmark">benchmark</option>
              <option value="collected">collected</option>
              <option value="synthetic">synthetic</option>
            </select>
          </label>
          {provenance === "synthetic" ? (
            <p role="note" className="border border-amber-700 bg-amber-950 px-2 py-1 text-xs text-amber-300">
              Synthetic rows are excluded from all metrics.
            </p>
          ) : null}
        </div>
      </div>

      <section aria-label="Uploads" className="flex flex-col gap-2">
        {uploads.map((row) => {
          const staged = row.detail ? stageStates(row.detail.file.status, row.detail.jobs) : null;
          const detail = row.detail;
          const needsReview = detail?.file.status === "needs_review" || detail?.file.status === "awaiting_review";
          return (
            <div key={row.key} className="border border-neutral-800 bg-neutral-900 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-neutral-100">{row.name}</span>
                <span className="text-xs text-neutral-500">{row.progress}%</span>
              </div>
              <div className="mt-1 h-1 bg-neutral-800" role="progressbar" aria-valuenow={row.progress} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-1 bg-blue-500 transition-[width] duration-180" style={{ width: `${row.progress}%` }} />
              </div>
              {staged ? (
                <div className="mt-2 flex items-center gap-2">
                  <StageDots states={staged.states} />
                  <span className="text-[11px] text-neutral-500">{INGEST_STAGES.join(" → ")}</span>
                </div>
              ) : null}
              {staged?.failedReason ? <p className="mt-1 text-xs text-red-400">{staged.failedReason}</p> : null}
              {row.error ? <p role="alert" className="mt-1 text-xs text-red-400">{row.error}</p> : null}
              {needsReview && detail ? (
                <button
                  type="button"
                  onClick={() => onOpenReview(detail.file.case_id)}
                  className="mt-2 border border-amber-700 px-2 py-1 text-xs text-amber-300"
                >
                  Awaiting Review — open review queue
                </button>
              ) : null}
            </div>
          );
        })}
        {uploads.length === 0 ? <p className="text-xs text-neutral-500">No uploads this session.</p> : null}
      </section>

      <section aria-label="Recent ingestions" className="border border-neutral-800 bg-neutral-900 p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">Recent Ingestions</h2>
          <button
            type="button"
            disabled={!caseId}
            onClick={() => onOpenReview(caseId)}
            className="border border-neutral-600 px-2 py-1 text-xs text-neutral-100 disabled:opacity-50"
          >
            Open review queue
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Last 20 source files for assigned cases — needs a files listing API; nothing is listed until it exists.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            aria-label="File id lookup"
            className="w-80 border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100"
            placeholder="File id for GET /files/{id}"
            value={lookupId}
            onChange={(event) => setLookupId(event.target.value.trim())}
          />
          <button type="button" onClick={lookup} className="border border-neutral-600 px-2 py-1 text-xs text-neutral-100">
            Open file
          </button>
          {detail ? (
            <button type="button" onClick={verify} className="border border-neutral-600 px-2 py-1 text-xs text-neutral-100">
              Verify
            </button>
          ) : null}
        </div>
        {detailError ? <p role="alert" className="mt-2 text-xs text-red-400">{detailError}</p> : null}
        {detail ? (
          <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
            <dt className="text-neutral-500">Name</dt><dd className="text-neutral-100">{detail.file.name}</dd>
            <dt className="text-neutral-500">MIME (server sniffed)</dt><dd className="text-neutral-100">{detail.file.mime}</dd>
            <dt className="text-neutral-500">Status</dt><dd className="text-neutral-100">{detail.file.status}</dd>
            <dt className="text-neutral-500">Provenance</dt><dd className="text-neutral-100">{detail.file.provenance}</dd>
            <dt className="text-neutral-500">Ledger tx</dt><dd className="text-neutral-100">{detail.ledger_tx_id ?? "(none)"}</dd>
          </dl>
        ) : null}
        {verifyResult ? (
          <p className={`mt-2 text-xs ${verifyResult.status === "verified" ? "text-green-400" : verifyResult.status === "tampered" ? "text-red-400" : "text-amber-300"}`}>
            {verifyResult.status.toUpperCase()} · computed {verifyResult.computed_hash.slice(0, 16)}… · ledger {(verifyResult.ledger_hash ?? "(none)").slice(0, 16)}…
          </p>
        ) : null}
      </section>
    </div>
  );
}
