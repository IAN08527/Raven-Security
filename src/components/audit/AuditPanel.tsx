import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invokeRaven } from "../../hooks/useInvoke";
import type { AuditEntry } from "../../types/generated";

interface LedgerRecord {
  fileId: string;
  filename: string;
  sha256: string;
  blockNumber: number;
  anchorTime: string;
  status: "VERIFIED" | "PENDING" | "TAMPERED";
  accessedBy: string;
  size: string;
}

const DEMO_LEDGER: LedgerRecord[] = [
  {
    fileId: "f-01",
    filename: "fir_102_final.pdf",
    sha256: "7a3f4c2d1e8b9a0f3e2d1c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f",
    blockNumber: 14209,
    anchorTime: "2024-08-28 14:30:02 UTC",
    status: "VERIFIED",
    accessedBy: "IO A. Kumar",
    size: "1.2 MB",
  },
  {
    fileId: "f-02",
    filename: "cdr_batch_march_2024.csv",
    sha256: "b4e29f1a8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f",
    blockNumber: 14210,
    anchorTime: "2024-08-28 14:35:18 UTC",
    status: "VERIFIED",
    accessedBy: "Analyst B. Singh",
    size: "4.8 MB",
  },
  {
    fileId: "f-03",
    filename: "suspect_wiretap_log_audio.wav",
    sha256: "9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b",
    blockNumber: 14212,
    anchorTime: "2024-08-28 15:10:44 UTC",
    status: "TAMPERED",
    accessedBy: "External Gateway (Mismatch)",
    size: "14.2 MB",
  },
  {
    fileId: "f-04",
    filename: "cctv_cam01_footage_clip.mp4",
    sha256: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
    blockNumber: 14215,
    anchorTime: "2024-08-28 15:45:00 UTC",
    status: "VERIFIED",
    accessedBy: "IO A. Kumar",
    size: "45.0 MB",
  },
  {
    fileId: "f-05",
    filename: "bank_ledger_syndicate_accts.xlsx",
    sha256: "3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e",
    blockNumber: 14218,
    anchorTime: "2024-08-28 16:00:11 UTC",
    status: "PENDING",
    accessedBy: "System Saga Ingestion",
    size: "820 KB",
  },
];

export function AuditPanel() {
  const [selectedRow, setSelectedRow] = useState<LedgerRecord>(DEMO_LEDGER[0]);
  const [search, setSearch] = useState("");

  const auditQuery = useQuery<AuditEntry[]>({
    queryKey: ["audit_log", "OP-RAVEN-01", 50],
    queryFn: async () => {
      return invokeRaven<AuditEntry[]>("get_audit_log", {
        caseId: "OP-RAVEN-01",
        limit: 50,
      });
    },
    staleTime: 30_000,
  });

  return (
    <div className="flex h-full flex-col bg-pd-base text-pd-text-primary p-4 overflow-y-auto select-none space-y-4">
      {/* 4 SUMMARY METRIC CARDS ROW */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Card 1: Total Entries */}
        <div className="rounded border border-pd-border bg-pd-surface p-3 space-y-1">
          <div className="text-pd-xs uppercase tracking-wider text-pd-text-tertiary">Total Entries</div>
          <div className="font-mono text-pd-2xl font-bold text-pd-accent">2,847</div>
          <div className="text-[11px] text-pd-text-tertiary">Immutable On-Chain Records</div>
        </div>

        {/* Card 2: Verified */}
        <div className="rounded border border-pd-border bg-pd-surface p-3 space-y-1">
          <div className="text-pd-xs uppercase tracking-wider text-pd-text-tertiary">Verified Hashes</div>
          <div className="font-mono text-pd-2xl font-bold text-pd-success">2,831</div>
          <div className="text-[11px] text-pd-success">100% SHA-256 Match Rate</div>
        </div>

        {/* Card 3: Pending Anchor */}
        <div className="rounded border border-pd-border bg-pd-surface p-3 space-y-1">
          <div className="text-pd-xs uppercase tracking-wider text-pd-text-tertiary">Pending Anchor</div>
          <div className="font-mono text-pd-2xl font-bold text-pd-warning">14</div>
          <div className="text-[11px] text-pd-warning">Awaiting Fabric Block Commit</div>
        </div>

        {/* Card 4: Tampered Warning */}
        <div className="rounded border border-pd-danger/40 bg-pd-danger/10 p-3 space-y-1 shadow-sm">
          <div className="text-pd-xs uppercase tracking-wider text-pd-danger flex items-center gap-1 font-bold">
            <span className="h-2 w-2 rounded-full bg-pd-danger animate-ping" />
            Tampered Evidence
          </div>
          <div className="font-mono text-pd-2xl font-bold text-pd-danger">2</div>
          <div className="text-[11px] text-pd-danger font-medium">Hash Mismatch Detected!</div>
        </div>
      </div>

      {/* MAIN CONTENT: (Forensic Data Table + Details Sidebar) */}
      <div className="flex flex-1 min-h-0 gap-4 flex-col lg:flex-row">
        {/* FORENSIC LEDGER TABLE */}
        <div className="flex-1 rounded border border-pd-border bg-pd-surface flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-pd-border bg-pd-elevated px-3 py-2">
            <span className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">
              Hyperledger Fabric Blockchain Ledger
            </span>
            <span className="font-mono text-[10px] text-pd-success flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-pd-success" />
              Consensus Healthy (Raft)
            </span>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left text-pd-xs border-collapse">
              <thead>
                <tr className="border-b border-pd-border bg-pd-elevated/60 text-pd-text-secondary uppercase tracking-wider h-7.5">
                  <th className="px-3 py-1 font-semibold">File ID</th>
                  <th className="px-3 py-1 font-semibold">Filename</th>
                  <th className="px-3 py-1 font-semibold font-mono">SHA-256 Hash</th>
                  <th className="px-3 py-1 font-semibold font-mono">Block #</th>
                  <th className="px-3 py-1 font-semibold">Status</th>
                  <th className="px-3 py-1 font-semibold">Accessed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-pd-border/40 font-mono">
                {DEMO_LEDGER.map((row) => {
                  const isSelected = selectedRow.fileId === row.fileId;
                  const isTampered = row.status === "TAMPERED";
                  return (
                    <tr
                      key={row.fileId}
                      onClick={() => setSelectedRow(row)}
                      className={`h-9 transition-colors cursor-pointer ${
                        isTampered
                          ? "bg-pd-danger/15 text-pd-danger hover:bg-pd-danger/20"
                          : isSelected
                          ? "bg-pd-accent/15 text-pd-accent"
                          : "hover:bg-pd-elevated text-pd-text-primary"
                      }`}
                    >
                      <td className="px-3 py-1 text-pd-text-tertiary">{row.fileId}</td>
                      <td className="px-3 py-1 font-sans font-medium text-pd-text-primary">
                        {row.filename}
                      </td>
                      <td className="px-3 py-1 text-pd-text-tertiary">
                        {row.sha256.substring(0, 16)}...{row.sha256.substring(56)}
                      </td>
                      <td className="px-3 py-1 text-pd-accent">#{row.blockNumber}</td>
                      <td className="px-3 py-1">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            isTampered
                              ? "bg-pd-danger text-pd-base"
                              : row.status === "VERIFIED"
                              ? "bg-pd-success/15 text-pd-success border border-pd-success/30"
                              : "bg-pd-warning/15 text-pd-warning border border-pd-warning/30"
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-1 font-sans text-pd-text-secondary">
                        {row.accessedBy}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          <div className="border-t border-pd-border bg-pd-elevated px-3 py-1.5 text-pd-xs text-pd-text-tertiary flex items-center justify-between">
            <span>Showing 5 of 2,847 committed ledger blocks</span>
            <span className="font-mono text-[10px]">Sync Delay: 12ms</span>
          </div>
        </div>

        {/* VERIFICATION DETAILS SIDEBAR */}
        <div className="w-full lg:w-80 rounded border border-pd-border bg-pd-surface p-3.5 space-y-3.5">
          <div className="flex items-center justify-between border-b border-pd-border pb-2">
            <span className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">
              Evidence Verification Inspector
            </span>
            <span
              className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                selectedRow.status === "TAMPERED"
                  ? "bg-pd-danger text-pd-base"
                  : "bg-pd-success/15 text-pd-success border border-pd-success/30"
              }`}
            >
              {selectedRow.status}
            </span>
          </div>

          <div>
            <div className="text-pd-sm font-semibold text-pd-text-primary">
              {selectedRow.filename}
            </div>
            <div className="text-pd-xs text-pd-text-tertiary font-mono">
              Size: {selectedRow.size} • Block #{selectedRow.blockNumber}
            </div>
          </div>

          {/* Hash Comparison Box */}
          <div className="rounded bg-pd-base p-2.5 border border-pd-border space-y-2 font-mono text-pd-xs">
            <div className="text-[10px] uppercase text-pd-text-tertiary font-sans font-semibold">
              SHA-256 Hash Comparison
            </div>
            <div>
              <div className="text-[10px] text-pd-text-tertiary">Ledger Anchored Hash:</div>
              <div className="text-pd-success text-[11px] break-all">
                {selectedRow.sha256}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-pd-text-tertiary">Current Storage Hash:</div>
              <div
                className={`text-[11px] break-all ${
                  selectedRow.status === "TAMPERED" ? "text-pd-danger font-bold" : "text-pd-success"
                }`}
              >
                {selectedRow.status === "TAMPERED"
                  ? "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 (MISMATCH)"
                  : selectedRow.sha256}
              </div>
            </div>
          </div>

          {/* Chain of Custody Timeline */}
          <div className="space-y-1.5">
            <div className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">
              Chain of Custody Events
            </div>
            <div className="space-y-2 text-pd-xs border-l-2 border-pd-accent/60 pl-3">
              <div>
                <div className="font-semibold text-pd-text-primary">Ingested & Stored</div>
                <div className="text-[10px] text-pd-text-tertiary font-mono">2024-08-28 14:30:00 • IO A. Kumar</div>
              </div>
              <div>
                <div className="font-semibold text-pd-text-primary">SHA-256 On-Chain Anchor</div>
                <div className="text-[10px] text-pd-text-tertiary font-mono">2024-08-28 14:30:02 • Block #{selectedRow.blockNumber}</div>
              </div>
              <div>
                <div className="font-semibold text-pd-text-primary">NER Extraction Run</div>
                <div className="text-[10px] text-pd-text-tertiary font-mono">2024-08-28 14:31:15 • Ollama Phi-3</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
