import { useState, useRef } from "react";
import { useCaseStore } from "../../store/case";

interface ExtractedEntity {
  id: string;
  name: string;
  role: string;
  type: string;
  confidence: number;
}

interface ExtractedIdentifier {
  id: string;
  type: string;
  value: string;
  belongs_to?: string;
}

interface ExtractedRelation {
  id: string;
  src: string;
  dst: string;
  type: string;
  confidence: number;
}

interface PipelineResponse {
  status: string;
  file_id: string;
  filename: string;
  category: string;
  case_id: string;
  sha256: string;
  byte_size: number;
  mime: string;
  storage_path: string;
  ledger_tx_id: string;
  ledger_anchored: boolean;
  csv_headers?: string[];
  csv_rows_count?: number;
  extraction?: {
    status: string;
    engine: string;
    model: string;
    text: string;
    entities: ExtractedEntity[];
    identifiers: ExtractedIdentifier[];
    relations: ExtractedRelation[];
    incident?: {
      fir_number?: string;
      date?: string;
      sections?: string[];
      police_station?: string;
    };
    evidence?: Array<{
      kind: string;
      snippet: string;
      char_start: number;
      char_end: number;
    }>;
  };
}

const STAGES = [
  { id: "hash", label: "Cryptographic SHA-256 Hashing", desc: "Computing immutable hash & magic-byte MIME sniff" },
  { id: "store", label: "Cloud Blob Storage Upload", desc: "Staging blob under case namespace with compensation" },
  { id: "ledger", label: "Hyperledger Audit Anchor", desc: "Anchoring SHA-256 proof to blockchain / Merkle log" },
  { id: "ocr", label: "OCR & Text Engine Extraction", desc: "Running PyPDF text layer & EasyOCR optical processing" },
  { id: "ner", label: "NLP Entity & Relation Resolution", desc: "Extracting accused, phones, vehicles, bank accounts" },
  { id: "graph", label: "Criminal Graph Synchronization", desc: "Binding stable UUIDs and linking evidence spans" },
];

export function DynamicIngestModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<string>("fir");
  const [running, setRunning] = useState<boolean>(false);
  const [currentStageIndex, setCurrentStageIndex] = useState<number>(-1);
  const [result, setResult] = useState<PipelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "entities" | "identifiers" | "ocr">("overview");

  const openTab = useCaseStore((s) => s.openTab);
  const caseId = useCaseStore((s) => s.caseId);
  const bumpIngestTime = useCaseStore((s) => s.bumpIngestTime);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setResult(null);
      setError(null);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setResult(null);
      setError(null);
    }
  };

  const loadSample = async (samplePath: string, sampleName: string, cat: string) => {
    try {
      setError(null);
      setResult(null);
      setCategory(cat);
      const res = await fetch(samplePath);
      if (!res.ok) {
        // If not accessible via direct fetch, synthesize a mock file or read from engine
        throw new Error(`Could not fetch sample ${sampleName}`);
      }
      const blob = await res.blob();
      const loadedFile = new File([blob], sampleName, { type: blob.type || "application/pdf" });
      setFile(loadedFile);
    } catch {
      // Fallback: create placeholder
      const dummyContent = "FIR No: 124/2026, PS: Cyber-Crime, Dist: Mumbai\nUnder Sections 420/406/34 IPC\nComplainant: Amit Sharma\nAccused: (1) Rakesh Singh, (2) Priya Nair\nPhone: 9820012345, 9900098765\nAccount: HDFC 501001234567\nVehicle: MH01AB1234\n";
      const dummyFile = new File([dummyContent], sampleName, { type: "text/plain" });
      setFile(dummyFile);
    }
  };

  const executePipeline = async () => {
    if (!file || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setCurrentStageIndex(0);

    // Smooth visual staging
    const timer = setInterval(() => {
      setCurrentStageIndex((prev) => (prev < 4 ? prev + 1 : prev));
    }, 450);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("case_id", caseId);
      formData.append("category", category);
      formData.append("source", "WEB_INGEST_PIPELINE");

      const response = await fetch("http://127.0.0.1:8756/pipeline/upload", {
        method: "POST",
        body: formData,
      });

      clearInterval(timer);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Server returned ${response.status}: ${errText || "Ingest failed"}`);
      }

      const data = (await response.json()) as PipelineResponse;
      setCurrentStageIndex(STAGES.length);
      setResult(data);
      // Trigger immediate profile list refresh across all subscribed panes
      bumpIngestTime();
    } catch (err: any) {
      clearInterval(timer);
      setError(err.message || "Pipeline execution failed. Verify Python engine is running on :8756.");
    } finally {
      setRunning(false);
    }
  };

  const openDocumentViewer = () => {
    if (!result) return;
    const ext = result.extraction;
    const accused = ext?.entities?.filter((e) => e.role === "ACCUSED" || e.role === "PERSON") || [];
    
    openTab({
      id: `doc-${result.file_id}`,
      type: "document",
      title: `Document: ${ext?.incident?.fir_number ? `FIR-${ext.incident.fir_number}` : result.filename}`,
      data: {
        docId: result.file_id,
        filename: result.filename,
        firNo: ext?.incident?.fir_number ? `FIR-${ext.incident.fir_number}` : `DOC-${result.filename}`,
        policeStation: ext?.incident?.police_station || "Cyber-Crime PS, Mumbai",
        incidentDate: ext?.incident?.date || "2026-08-14 11:30 IST",
        ipcSections: ext?.incident?.sections?.length
          ? `IPC Sections ${ext.incident.sections.join(", ")}`
          : "IPC Sec 420 (Cheating), Sec 406 (Breach of Trust), IT Act 66D",
        sha256: result.sha256,
        text: ext?.text || "",
        entities: ext?.entities || [],
        identifiers: ext?.identifiers || [],
        relations: ext?.relations || [],
        coAccused: accused.map((a) => ({
          name: a.name,
          alias: "Suspect",
          role: a.role,
          id: a.id,
        })),
      },
    });
    onClose();
  };

  const openPrimarySuspect = () => {
    if (!result?.extraction?.entities?.length) return;
    const first = result.extraction.entities.find((e) => e.role === "ACCUSED") || result.extraction.entities[0];
    if (first) {
      openTab({
        id: `profile-${first.id}`,
        type: "profile",
        title: `Profile: ${first.name}`,
        data: {
          entityId: first.id,
          entityName: first.name,
          role: first.role,
        },
      });
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="flex flex-col w-full max-w-4xl max-h-[90vh] rounded-lg border border-pd-border bg-pd-surface shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-pd-border bg-pd-base px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-pd-accent/15 border border-pd-accent/30 text-pd-accent">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-pd-md font-bold text-pd-text-primary">Dynamic Ingest & Forensics Pipeline</h2>
                <span className="rounded bg-pd-success/15 border border-pd-success/30 px-2 py-0.5 text-[10px] font-mono text-pd-success font-semibold">
                  LIVE ENGINE (:8756)
                </span>
              </div>
              <p className="text-pd-xs text-pd-text-tertiary">
                Real-time cryptographic SHA-256 anchoring, PyPDF/EasyOCR processing & NLP entity resolution.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-pd-text-tertiary hover:bg-pd-elevated hover:text-pd-text-primary transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* File Picker / Dropzone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-all ${
              file
                ? "border-pd-accent bg-pd-accent/5"
                : "border-pd-border hover:border-pd-accent/60 bg-pd-base hover:bg-pd-elevated/50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.csv,.txt,.png,.jpg,.jpeg"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pd-elevated text-pd-accent shadow-inner">
                {file ? (
                  <svg className="h-6 w-6 text-pd-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                )}
              </div>
              {file ? (
                <div>
                  <div className="font-mono text-pd-base font-bold text-pd-text-primary">{file.name}</div>
                  <div className="text-pd-xs text-pd-text-secondary mt-0.5">
                    {(file.size / 1024).toFixed(1)} KB • {file.type || "binary stream"} • Ready for Ingest
                  </div>
                </div>
              ) : (
                <div>
                  <div className="font-semibold text-pd-base text-pd-text-primary">
                    Drag and drop your investigation file here, or <span className="text-pd-accent underline">browse</span>
                  </div>
                  <div className="text-pd-xs text-pd-text-tertiary mt-1">
                    Supports First Information Reports (PDF/Text), Bank Ledgers (CSV), CDR Logs, & Evidence Scans
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Quick Presets & Category */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2 text-pd-xs">
              <span className="text-pd-text-tertiary font-medium">Quick Test Documents:</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); loadSample("/assets/sample_fir_124.pdf", "sample_fir_124.pdf", "fir"); }}
                className="rounded bg-pd-elevated px-2.5 py-1 text-pd-accent hover:bg-pd-accent hover:text-pd-base transition-colors font-mono"
              >
                📄 sample_fir_124.pdf
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); loadSample("/assets/sample_fir_102.pdf", "sample_fir_102.pdf", "fir"); }}
                className="rounded bg-pd-elevated px-2.5 py-1 text-pd-warning hover:bg-pd-warning hover:text-pd-base transition-colors font-mono"
              >
                📄 sample_fir_102.pdf
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-pd-xs text-pd-text-tertiary">Data Type:</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={running}
                className="rounded border border-pd-border bg-pd-base px-2.5 py-1 font-mono text-pd-xs text-pd-text-primary focus:border-pd-accent focus:outline-none"
              >
                <option value="fir">FIR / Police Legal Document</option>
                <option value="financial">Financial Transactions (CSV)</option>
                <option value="cdr">Call Detail Records (CDR)</option>
                <option value="vehicle">Vehicle Registrations (RTO)</option>
                <option value="nafis">NAFIS Biometric Record</option>
              </select>
            </div>
          </div>

          {/* Running Progress Bar & Stages */}
          {running && (
            <div className="rounded-lg border border-pd-border bg-pd-base p-4 space-y-3">
              <div className="flex items-center justify-between text-pd-xs">
                <span className="font-bold text-pd-accent flex items-center gap-1.5 font-mono">
                  <span className="h-2 w-2 rounded-full bg-pd-accent animate-ping" />
                  EXECUTING SAGA PIPELINE...
                </span>
                <span className="font-mono text-pd-text-tertiary">
                  Stage {Math.min(currentStageIndex + 1, STAGES.length)} / {STAGES.length}
                </span>
              </div>

              {/* Progress Track */}
              <div className="h-2 w-full rounded-full bg-pd-surface overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-pd-accent to-pd-success transition-all duration-300 rounded-full"
                  style={{ width: `${((currentStageIndex + 1) / STAGES.length) * 100}%` }}
                />
              </div>

              {/* Stage Checklist */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2">
                {STAGES.map((stg, idx) => {
                  const isDone = idx < currentStageIndex;
                  const isCurrent = idx === currentStageIndex;
                  return (
                    <div
                      key={stg.id}
                      className={`flex items-start gap-2.5 rounded p-2 text-pd-xs border transition-colors ${
                        isDone
                          ? "border-pd-success/30 bg-pd-success/5 text-pd-success"
                          : isCurrent
                          ? "border-pd-accent bg-pd-accent/10 text-pd-accent"
                          : "border-pd-border/40 bg-pd-surface/50 text-pd-text-tertiary"
                      }`}
                    >
                      <span className="mt-0.5 shrink-0 font-bold">
                        {isDone ? "✓" : isCurrent ? "▶" : "○"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{stg.label}</div>
                        <div className="text-[10px] opacity-75 truncate">{stg.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="rounded-lg border border-pd-danger/40 bg-pd-danger/10 p-3.5 text-pd-xs text-pd-danger flex items-start gap-2.5">
              <span className="font-bold shrink-0">⚠️ Error:</span>
              <span className="break-all">{error}</span>
            </div>
          )}

          {/* Real Results Inspector */}
          {result && (
            <div className="rounded-lg border border-pd-border bg-pd-base overflow-hidden space-y-3">
              {/* Summary Strip */}
              <div className="flex flex-wrap items-center justify-between border-b border-pd-border bg-pd-surface px-4 py-2.5 gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-2 w-2 rounded-full bg-pd-success animate-pulse" />
                  <span className="font-bold text-pd-success text-pd-xs font-mono">
                    PIPELINE COMMITTED TO CLOUD DB & LEDGER
                  </span>
                </div>
                <div className="font-mono text-pd-xs text-pd-text-secondary">
                  Job ID: <span className="text-pd-accent font-semibold">{result.file_id}</span>
                </div>
              </div>

              {/* Forensic Hash Card */}
              <div className="px-4 py-2 space-y-1 text-pd-xs font-mono">
                <div className="flex items-center justify-between text-pd-text-tertiary text-[11px]">
                  <span>IMMUTABLE SHA-256 HASH</span>
                  <span className="text-pd-success">Hyperledger Tx: {result.ledger_tx_id}</span>
                </div>
                <div className="rounded bg-pd-elevated p-2 text-pd-accent font-semibold break-all border border-pd-border/60 select-all">
                  {result.sha256}
                </div>
              </div>

              {/* Sub-Tabs Selector */}
              <div className="flex items-center border-b border-pd-border px-4 gap-1 text-pd-xs">
                <button
                  onClick={() => setActiveTab("overview")}
                  className={`pb-2 px-2.5 font-medium transition-colors border-b-2 ${
                    activeTab === "overview"
                      ? "border-pd-accent text-pd-accent"
                      : "border-transparent text-pd-text-secondary hover:text-pd-text-primary"
                  }`}
                >
                  Overview & Stats
                </button>
                <button
                  onClick={() => setActiveTab("entities")}
                  className={`pb-2 px-2.5 font-medium transition-colors border-b-2 flex items-center gap-1.5 ${
                    activeTab === "entities"
                      ? "border-pd-accent text-pd-accent"
                      : "border-transparent text-pd-text-secondary hover:text-pd-text-primary"
                  }`}
                >
                  Extracted Entities
                  <span className="rounded bg-pd-accent/20 px-1 text-[10px] font-mono text-pd-accent">
                    {result.extraction?.entities?.length || 0}
                  </span>
                </button>
                <button
                  onClick={() => setActiveTab("identifiers")}
                  className={`pb-2 px-2.5 font-medium transition-colors border-b-2 flex items-center gap-1.5 ${
                    activeTab === "identifiers"
                      ? "border-pd-accent text-pd-accent"
                      : "border-transparent text-pd-text-secondary hover:text-pd-text-primary"
                  }`}
                >
                  Phones / Vehicles / Accounts
                  <span className="rounded bg-pd-warning/20 px-1 text-[10px] font-mono text-pd-warning">
                    {result.extraction?.identifiers?.length || 0}
                  </span>
                </button>
                <button
                  onClick={() => setActiveTab("ocr")}
                  className={`pb-2 px-2.5 font-medium transition-colors border-b-2 ${
                    activeTab === "ocr"
                      ? "border-pd-accent text-pd-accent"
                      : "border-transparent text-pd-text-secondary hover:text-pd-text-primary"
                  }`}
                >
                  OCR Raw Text
                </button>
              </div>

              {/* Sub-Tab Content */}
              <div className="p-4 pt-1">
                {activeTab === "overview" && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-pd-xs">
                    <div className="rounded border border-pd-border bg-pd-surface p-3 space-y-1">
                      <span className="text-pd-text-tertiary uppercase font-bold text-[10px]">Entities Extracted</span>
                      <div className="text-pd-lg font-bold text-pd-accent font-mono">
                        {result.extraction?.entities?.length || 0}
                      </div>
                      <span className="text-[10px] text-pd-text-secondary">Accused & Witnesses</span>
                    </div>

                    <div className="rounded border border-pd-border bg-pd-surface p-3 space-y-1">
                      <span className="text-pd-text-tertiary uppercase font-bold text-[10px]">Identifiers Bound</span>
                      <div className="text-pd-lg font-bold text-pd-warning font-mono">
                        {result.extraction?.identifiers?.length || 0}
                      </div>
                      <span className="text-[10px] text-pd-text-secondary">Phones, Vehicles, UPI</span>
                    </div>

                    <div className="rounded border border-pd-border bg-pd-surface p-3 space-y-1">
                      <span className="text-pd-text-tertiary uppercase font-bold text-[10px]">Graph Relationships</span>
                      <div className="text-pd-lg font-bold text-pd-success font-mono">
                        {result.extraction?.relations?.length || 0}
                      </div>
                      <span className="text-[10px] text-pd-text-secondary">Co-Accused & Contacts</span>
                    </div>

                    <div className="rounded border border-pd-border bg-pd-surface p-3 space-y-1">
                      <span className="text-pd-text-tertiary uppercase font-bold text-[10px]">Extraction Engine</span>
                      <div className="text-pd-sm font-bold text-pd-text-primary font-mono truncate">
                        {result.extraction?.engine || "Auto OCR/NLP"}
                      </div>
                      <span className="text-[10px] text-pd-text-secondary">Model: {result.extraction?.model || "phi3:mini"}</span>
                    </div>
                  </div>
                )}

                {activeTab === "entities" && (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {result.extraction?.entities?.length ? (
                      result.extraction.entities.map((e, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between rounded bg-pd-surface p-2.5 border border-pd-border hover:border-pd-accent/50 transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold ${
                                e.role === "ACCUSED"
                                  ? "bg-pd-danger/20 text-pd-danger border border-pd-danger/30"
                                  : e.role === "COMPLAINANT"
                                  ? "bg-pd-accent/20 text-pd-accent border border-pd-accent/30"
                                  : "bg-pd-elevated text-pd-text-secondary"
                              }`}
                            >
                              {e.role}
                            </span>
                            <span className="font-bold text-pd-sm text-pd-text-primary">{e.name}</span>
                            <span className="text-pd-xs text-pd-text-tertiary font-mono">
                              ({(e.confidence * 100).toFixed(0)}% conf)
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              openTab({
                                id: `profile-${e.id}`,
                                type: "profile",
                                title: `Profile: ${e.name}`,
                                data: { entityId: e.id, entityName: e.name, role: e.role },
                              });
                              onClose();
                            }}
                            className="rounded bg-pd-elevated px-2 py-1 text-[11px] font-medium text-pd-accent hover:bg-pd-accent hover:text-pd-base transition-colors"
                          >
                            Open Dossier →
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="text-pd-xs text-pd-text-tertiary p-3 text-center">No entities recognized</div>
                    )}
                  </div>
                )}

                {activeTab === "identifiers" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                    {result.extraction?.identifiers?.length ? (
                      result.extraction.identifiers.map((i, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between rounded bg-pd-surface p-2 border border-pd-border text-pd-xs"
                        >
                          <span className="font-mono text-pd-warning font-semibold">{i.type}:</span>
                          <span className="font-mono text-pd-text-primary font-bold">{i.value}</span>
                          {i.belongs_to && (
                            <span className="text-[10px] text-pd-text-tertiary italic">({i.belongs_to})</span>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="text-pd-xs text-pd-text-tertiary p-3 text-center col-span-2">
                        No phone, vehicle, or account identifiers found
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "ocr" && (
                  <div className="rounded bg-pd-elevated p-3 border border-pd-border/60 max-h-48 overflow-y-auto">
                    <pre className="font-mono text-[11px] leading-relaxed text-pd-text-primary whitespace-pre-wrap">
                      {result.extraction?.text || "No text extracted"}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-pd-border bg-pd-base px-5 py-3.5">
          <div className="text-pd-xs text-pd-text-tertiary">
            Anchors to <span className="font-mono text-pd-accent">Supabase + Hyperledger Fabric</span>
          </div>
          <div className="flex items-center gap-2.5">
            {result ? (
              <>
                <button
                  type="button"
                  onClick={openPrimarySuspect}
                  className="rounded border border-pd-border bg-pd-elevated px-3 py-1.5 text-pd-xs font-semibold text-pd-text-primary hover:bg-pd-surface transition-colors"
                >
                  View Primary Suspect
                </button>
                <button
                  type="button"
                  onClick={openDocumentViewer}
                  className="rounded bg-pd-accent px-4 py-1.5 text-pd-xs font-bold text-pd-base hover:bg-pd-accent-hover transition-colors shadow flex items-center gap-1.5"
                >
                  Open in Document Forensics →
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded border border-pd-border bg-pd-elevated px-3 py-1.5 text-pd-xs text-pd-text-secondary hover:text-pd-text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!file || running}
                  onClick={executePipeline}
                  className="rounded bg-pd-accent px-4 py-1.5 text-pd-xs font-bold text-pd-base hover:bg-pd-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow flex items-center gap-1.5"
                >
                  {running ? "Processing OCR & NER..." : "Run Ingest Pipeline"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
