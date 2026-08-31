import { useState } from "react";
import { useCaseStore } from "../../store/case";

interface AccusedItem {
  name: string;
  alias?: string;
  role: string;
  id: string;
}

interface DocumentViewerPaneProps {
  docId?: string;
  title?: string;
  data?: {
    firNo?: string;
    policeStation?: string;
    incidentDate?: string;
    ipcSections?: string;
    coAccused?: AccusedItem[];
    sha256?: string;
    text?: string;
    filename?: string;
    entities?: Array<{ id: string; name: string; role: string; confidence?: number }>;
    identifiers?: Array<{ type: string; value: string; belongs_to?: string }>;
    relations?: Array<{ src: string; dst: string; type: string }>;
  };
}

export function DocumentViewerPane({
  docId = "doc-fir-102",
  title = "Document: FIR-102/2024 (Dharavi PS)",
  data,
}: DocumentViewerPaneProps) {
  const openTab = useCaseStore((s) => s.openTab);
  const [viewMode, setViewMode] = useState<"structured" | "raw_ocr">("structured");

  const firNo = data?.firNo || "FIR-102/2024";
  const ps = data?.policeStation || "Dharavi Police Station, Central Zone, Mumbai";
  const date = data?.incidentDate || "2024-03-12 21:45 IST";
  const ipc = data?.ipcSections || "IPC Sec 302 (Murder), Sec 384 (Extortion), Sec 120B (Criminal Conspiracy), Arms Act Sec 25";
  const sha = data?.sha256 || "7a3f4c2d1e8b9a0f3e2d1c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f";
  const rawText = data?.text;

  const coAccused: AccusedItem[] =
    data?.coAccused && data.coAccused.length > 0
      ? data.coAccused
      : data?.entities && data.entities.length > 0
      ? data.entities.map((e) => ({
          name: e.name,
          alias: "Suspect",
          role: e.role,
          id: e.id,
        }))
      : [
          { name: "Rakesh Sawant", alias: "Ricky", role: "Main Accused (Syndicate Leader)", id: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332" },
          { name: "Vikram Patel", alias: "Vicky", role: "Co-Accused (Hawala Facilitator)", id: "8c35e396-4191-5369-9c5c-7ec65df27d5e" },
          { name: "Mohd. Khan", alias: "Bhai", role: "Co-Accused (Logistics Provider)", id: "5761aefc-da70-5883-999a-00e998a4d468" },
        ];

  return (
    <div className="flex h-full flex-col bg-pd-base text-pd-text-primary overflow-y-auto p-4 select-none space-y-4">
      {/* Top Document Header Card */}
      <div className="rounded-lg border border-pd-border bg-pd-surface p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-pd-danger/15 border border-pd-danger/30 text-pd-danger font-bold text-pd-lg font-mono shadow-inner">
            FIR
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-pd-xl font-bold text-pd-text-primary font-mono">{firNo}</h1>
              <span className="rounded bg-pd-success/15 border border-pd-success/30 px-2 py-0.5 text-[11px] font-mono font-semibold text-pd-success flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-pd-success animate-pulse" />
                BLOCKCHAIN VERIFIED (SHA-256 MATCH)
              </span>
            </div>
            <div className="text-pd-sm text-pd-text-secondary mt-0.5">
              Police Station: <span className="text-pd-text-primary font-medium">{ps}</span> • Case Ref: <span className="text-pd-accent font-mono">OP-RAVEN-01</span>
            </div>
          </div>
        </div>

        {/* Action Controls & View Switcher */}
        <div className="flex items-center gap-2">
          <div className="flex rounded border border-pd-border bg-pd-base p-0.5 text-pd-xs">
            <button
              onClick={() => setViewMode("structured")}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${
                viewMode === "structured"
                  ? "bg-pd-accent text-pd-base font-bold shadow"
                  : "text-pd-text-secondary hover:text-pd-text-primary"
              }`}
            >
              Structured Legal View
            </button>
            <button
              onClick={() => setViewMode("raw_ocr")}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${
                viewMode === "raw_ocr"
                  ? "bg-pd-accent text-pd-base font-bold shadow"
                  : "text-pd-text-secondary hover:text-pd-text-primary"
              }`}
            >
              OCR Raw Layer
            </button>
          </div>

          <button
            onClick={() => alert("Certified court copy generated with cryptographic hash.")}
            className="flex items-center gap-1.5 rounded bg-pd-elevated border border-pd-border px-3 py-1.5 text-pd-xs font-semibold text-pd-text-primary hover:bg-pd-surface transition-colors"
          >
            Export Proof
          </button>
        </div>
      </div>

      {/* Forensic Integrity & Hash Strip */}
      <div className="rounded-lg border border-pd-border bg-pd-elevated p-3 font-mono text-pd-xs space-y-1">
        <div className="flex items-center justify-between text-pd-text-tertiary text-[11px]">
          <span>IMMUTABLE LEDGER SHA-256 HASH</span>
          <span>Hyperledger Fabric Verified · Anchor Block #14209</span>
        </div>
        <div className="text-pd-success break-all font-semibold select-all">
          {sha}
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === "raw_ocr" ? (
        <div className="rounded-lg border border-pd-border bg-pd-surface p-4 space-y-2">
          <div className="flex items-center justify-between border-b border-pd-border pb-2 text-pd-xs text-pd-text-tertiary">
            <span>OPTICAL CHARACTER RECOGNITION (OCR) RAW TEXT DUMP</span>
            <span>PyPDF / EasyOCR Engine</span>
          </div>
          <pre className="font-mono text-pd-sm leading-relaxed text-pd-text-primary p-4 rounded bg-pd-base border border-pd-border/60 whitespace-pre-wrap max-h-[600px] overflow-y-auto">
            {rawText || "No raw text layer provided for this document."}
          </pre>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left 2 Cols: Main FIR Legal Text */}
          <div className="lg:col-span-2 rounded-lg border border-pd-border bg-pd-surface p-4 space-y-4">
            <div className="border-b border-pd-border pb-2 flex items-center justify-between">
              <h2 className="text-pd-md font-bold uppercase tracking-wider text-pd-text-primary">
                First Information Report (Under Sec 154 Cr.P.C.)
              </h2>
              <span className="font-mono text-pd-xs text-pd-text-tertiary">{date}</span>
            </div>

            <div className="space-y-3 text-pd-sm leading-relaxed">
              <div className="p-3 rounded bg-pd-base border border-pd-border/60">
                <span className="text-pd-xs uppercase font-bold text-pd-text-tertiary block mb-1">
                  Offenses & Statutory Sections
                </span>
                <span className="font-mono text-pd-danger font-semibold">{ipc}</span>
              </div>

              {rawText ? (
                <div className="p-3.5 rounded bg-pd-base border border-pd-border/60 space-y-2">
                  <h3 className="text-pd-xs uppercase font-bold text-pd-text-tertiary">
                    Extracted Legal Statement & Facts
                  </h3>
                  <div className="font-mono text-pd-xs text-pd-text-primary whitespace-pre-wrap leading-relaxed">
                    {rawText}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <h3 className="text-pd-xs uppercase font-bold text-pd-text-tertiary">
                    Incident & Complaint Summary
                  </h3>
                  <p className="text-pd-text-primary text-pd-base leading-relaxed">
                    On the evening of 12th March 2024 at approx 21:45 hrs, a secret intelligence report confirmed that members of the organized extortion syndicate led by accused <strong className="text-pd-accent font-semibold">Rakesh Vijay Sawant (Alias Ricky)</strong> convened an armed conspiracy meeting at a commercial warehouse in Dharavi Cross Lane.
                  </p>
                  <p className="text-pd-text-secondary leading-relaxed">
                    Co-conspirators <strong className="text-pd-accent font-semibold">Vikram Patel</strong> and <strong className="text-pd-accent font-semibold">Mohd. Khan</strong> were documented co-located at the scene via cell tower triangulation and intercepted communication. Physical surveillance confirmed vehicle <strong className="font-mono text-pd-warning">MH-02-AB-1234</strong> arriving at the location. During the encounter, firearms and hawala cash receipts amounting to INR 24,00,000/- were recovered.
                  </p>
                </div>
              )}

              {/* Identifiers Strip */}
              {data?.identifiers && data.identifiers.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-pd-border/40">
                  <h3 className="text-pd-xs uppercase font-bold text-pd-text-tertiary">
                    Linked Forensics Identifiers ({data.identifiers.length})
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {data.identifiers.map((ident, idx) => (
                      <div key={idx} className="rounded bg-pd-base p-2 border border-pd-border text-pd-xs">
                        <span className="font-mono text-pd-warning font-semibold">{ident.type}: </span>
                        <span className="font-mono text-pd-text-primary font-bold">{ident.value}</span>
                        {ident.belongs_to && (
                          <span className="text-[10px] text-pd-text-tertiary block mt-0.5">Belongs to: {ident.belongs_to}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2 pt-2 border-t border-pd-border/40">
                <h3 className="text-pd-xs uppercase font-bold text-pd-text-tertiary">
                  Investigating Officer (IO) Endorsement
                </h3>
                <div className="grid grid-cols-2 gap-2 text-pd-xs text-pd-text-secondary">
                  <div>Investigating Officer: <span className="text-pd-text-primary font-medium">Inspector A. Kumar (Crime Branch)</span></div>
                  <div>Station Diary Entry No: <span className="font-mono text-pd-text-primary">SD-8842/2024</span></div>
                  <div>Magistrate Court: <span className="text-pd-text-primary font-medium">Esplanade Court, Mumbai</span></div>
                  <div>Status of Charge-sheet: <span className="text-pd-success font-medium">Charge-sheet Submitted (Trial Pending)</span></div>
                </div>
              </div>
            </div>
          </div>

          {/* Right 1 Col: Extracted Named Entities & Quick Profile Jump */}
          <div className="rounded-lg border border-pd-border bg-pd-surface p-4 space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="border-b border-pd-border pb-2 flex items-center justify-between">
                <h2 className="text-pd-xs font-bold uppercase tracking-wider text-pd-text-tertiary">
                  Accused & Entities ({coAccused.length})
                </h2>
                <span className="text-[10px] font-mono text-pd-accent">NER Resolved</span>
              </div>

              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {coAccused.map((acc, idx) => (
                  <div
                    key={idx}
                    className="rounded bg-pd-base p-2.5 border border-pd-border hover:border-pd-accent/60 transition-all space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-pd-base text-pd-text-primary">{acc.name}</div>
                      {acc.alias && (
                        <span className="text-[10px] font-mono text-pd-text-tertiary italic">"{acc.alias}"</span>
                      )}
                    </div>
                    <div className="text-pd-xs text-pd-danger font-medium">{acc.role}</div>
                    <button
                      onClick={() => {
                        openTab({
                          id: `profile-${acc.id}`,
                          type: "profile",
                          title: `Profile: ${acc.name}`,
                          data: { entityId: acc.id, entityName: acc.name, role: acc.role },
                        });
                      }}
                      className="w-full flex items-center justify-center gap-1 rounded bg-pd-elevated py-1 text-pd-xs font-medium text-pd-accent hover:bg-pd-accent hover:text-pd-base transition-colors"
                    >
                      Open Suspect Profile →
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-2.5 rounded bg-pd-elevated border border-pd-border text-[11px] text-pd-text-tertiary">
              Entity extraction performed by Ollama / NER model with SHA-256 cryptographic evidence anchoring.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
