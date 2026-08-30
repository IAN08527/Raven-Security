import { useCaseStore } from "../../store/case";

interface AccusedItem {
  name: string;
  alias: string;
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
  };
}


export function DocumentViewerPane({
  docId = "doc-fir-102",
  title = "Document: FIR-102/2024 (Dharavi PS)",
  data,
}: DocumentViewerPaneProps) {
  const openTab = useCaseStore((s) => s.openTab);

  const firNo = data?.firNo || "FIR-102/2024";
  const ps = data?.policeStation || "Dharavi Police Station, Central Zone, Mumbai";
  const date = data?.incidentDate || "2024-03-12 21:45 IST";
  const ipc = data?.ipcSections || "IPC Sec 302 (Murder), Sec 384 (Extortion), Sec 120B (Criminal Conspiracy), Arms Act Sec 25";
  const sha = data?.sha256 || "7a3f4c2d1e8b9a0f3e2d1c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f";
  const coAccused = data?.coAccused || [
    { name: "Rakesh Sawant", alias: "Ricky", role: "Main Accused (Syndicate Leader)", id: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332" },
    { name: "Vikram Patel", alias: "Vicky", role: "Co-Accused (Hawala Facilitator)", id: "8c35e396-4191-5369-9c5c-7ec65df27d5e" },
    { name: "Mohd. Khan", alias: "Bhai", role: "Co-Accused (Logistics Provider)", id: "5761aefc-da70-5883-999a-00e998a4d468" },
  ];

  return (
    <div className="flex h-full flex-col bg-pd-base text-pd-text-primary overflow-y-auto p-4 select-none space-y-4">
      {/* Top Document Header Card */}
      <div className="rounded border border-pd-border bg-pd-surface p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded bg-pd-danger/15 border border-pd-danger/30 text-pd-danger font-bold text-pd-lg font-mono">
            FIR
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-pd-xl font-bold text-pd-text-primary font-mono">{firNo}</h1>
              <span className="rounded bg-pd-success/15 border border-pd-success/30 px-2 py-0.5 text-[11px] font-mono font-semibold text-pd-success flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-pd-success" />
                BLOCKCHAIN VERIFIED (SHA-256 MATCH)
              </span>
            </div>
            <div className="text-pd-sm text-pd-text-secondary mt-0.5">
              Police Station: <span className="text-pd-text-primary font-medium">{ps}</span> • Case Ref: <span className="text-pd-accent font-mono">OP-RAVEN-01</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => alert("Printing verified court copy...")}
            className="flex items-center gap-1.5 rounded border border-pd-border bg-pd-elevated px-3 py-1.5 text-pd-xs text-pd-text-secondary hover:text-pd-text-primary transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print Court Copy
          </button>
          <button
            onClick={() => alert("Exporting certified digital certificate...")}
            className="flex items-center gap-1.5 rounded bg-pd-accent px-3 py-1.5 text-pd-xs font-bold text-pd-base hover:bg-pd-accent-hover transition-colors shadow"
          >
            Export Ledger Certificate
          </button>
        </div>
      </div>

      {/* Forensic Integrity & Hash Strip */}
      <div className="rounded border border-pd-border bg-pd-elevated p-3 font-mono text-pd-xs space-y-1">
        <div className="flex items-center justify-between text-pd-text-tertiary text-[11px]">
          <span>IMMUTABLE LEDGER SHA-256 HASH</span>
          <span>Hyperledger Fabric Block #14209</span>
        </div>
        <div className="text-pd-success break-all font-semibold select-all">
          {sha}
        </div>
      </div>

      {/* Structured Legal Document Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left 2 Cols: Main FIR Legal Text */}
        <div className="lg:col-span-2 rounded border border-pd-border bg-pd-surface p-4 space-y-4">
          <div className="border-b border-pd-border pb-2 flex items-center justify-between">
            <h2 className="text-pd-md font-bold uppercase tracking-wider text-pd-text-primary">
              First Information Report (Under Sec 154 Cr.P.C.)
            </h2>
            <span className="font-mono text-pd-xs text-pd-text-tertiary">{date}</span>
          </div>

          <div className="space-y-3 text-pd-sm leading-relaxed">
            <div className="p-3 rounded bg-pd-base border border-pd-border/60">
              <span className="text-pd-xs uppercase font-bold text-pd-text-tertiary block mb-1">
                Offenses & Acts Charged
              </span>
              <span className="font-mono text-pd-danger font-semibold">{ipc}</span>
            </div>

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

            <div className="space-y-2 pt-2 border-t border-pd-border/40">
              <h3 className="text-pd-xs uppercase font-bold text-pd-text-tertiary">
                Investigating Officer (IO) Endorsement
              </h3>
              <div className="grid grid-cols-2 gap-2 text-pd-xs text-pd-text-secondary">
                <div>Investigating Officer: <span className="text-pd-text-primary font-medium">Inspector A. Kumar (Crime Branch)</span></div>
                <div>Station Diary Entry No: <span className="font-mono text-pd-text-primary">SD-8842/2024</span></div>
                <div>Magistrate Court: <span className="text-pd-text-primary font-medium">Esplanade Court, Mumbai</span></div>
                <div>Status of Charge-sheet: <span className="text-pd-success font-medium">Charge-sheet Submitted (Court Trial Pending)</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* Right 1 Col: Extracted Named Entities & Quick Profile Jump */}
        <div className="rounded border border-pd-border bg-pd-surface p-4 space-y-3 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="border-b border-pd-border pb-2">
              <h2 className="text-pd-xs font-bold uppercase tracking-wider text-pd-text-tertiary">
                Accused Named in this FIR ({coAccused.length})
              </h2>
            </div>

            <div className="space-y-2">
              {coAccused.map((acc, idx) => (
                <div
                  key={idx}
                  className="rounded bg-pd-base p-2.5 border border-pd-border hover:border-pd-accent/60 transition-all space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-pd-base text-pd-text-primary">{acc.name}</div>
                    <span className="text-[10px] font-mono text-pd-text-tertiary italic">"{acc.alias}"</span>
                  </div>
                  <div className="text-pd-xs text-pd-danger font-medium">{acc.role}</div>
                  <button
                    onClick={() => {
                      openTab({
                        id: `profile-${acc.id}`,
                        type: "profile",
                        title: `Profile: ${acc.name}`,
                        data: { entityId: acc.id, entityName: acc.name },
                      });
                    }}
                    className="w-full flex items-center justify-center gap-1 rounded bg-pd-elevated py-1 text-pd-xs font-medium text-pd-accent hover:bg-pd-accent hover:text-pd-base transition-colors"
                  >
                    Open Suspect Profile
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="p-2.5 rounded bg-pd-elevated border border-pd-border text-[11px] text-pd-text-tertiary">
            Entity extraction performed by Ollama NER with SHA-256 evidence anchoring.
          </div>
        </div>
      </div>
    </div>
  );
}
