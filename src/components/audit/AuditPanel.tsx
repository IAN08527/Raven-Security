import { CSSProperties, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invokeRaven } from "../../hooks/useInvoke";
import { useCaseStore, type LedgerRecord } from "../../store/case";
import type { AuditEntry } from "../../types/generated";

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

// ── RAVEN-refactor theme tokens (match RavenShell) ──
const AC = "#e8c15a";
const hexA = (h: string, a: number) => h + Math.round(a * 255).toString(16).padStart(2, "0");
const GREEN = "#5ecf9a";
const AMBER = "#e0a63d";
const RED = "#ff5a3c";
const MONO = "'Spline Sans Mono',monospace";
const mono = (extra?: CSSProperties): CSSProperties => ({ fontFamily: MONO, ...extra });

const th: CSSProperties = mono({ padding: "0 8px", fontSize: 9, fontWeight: 500, letterSpacing: ".16em", color: "#5c6773", textAlign: "left" });

export function AuditPanel() {
  const auditLog = useCaseStore((s) => s.auditLog);
  const [selectedRow, setSelectedRow] = useState<LedgerRecord>(auditLog[0] || DEMO_LEDGER[0]);
  const [search, setSearch] = useState("");
  void search;

  useEffect(() => {
    if (auditLog.length > 0 && !auditLog.some((r) => r.fileId === selectedRow.fileId)) {
      setSelectedRow(auditLog[0]);
    }
  }, [auditLog, selectedRow.fileId]);

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
  void auditQuery;

  const selTam = selectedRow.status === "TAMPERED";

  return (
    <div style={{ display: "flex", height: "100%", flexDirection: "column", overflow: "hidden", background: "#060809", color: "#e8edf2", fontFamily: "'Instrument Sans',system-ui,sans-serif", fontSize: 13 }}>
      <style dangerouslySetInnerHTML={{ __html: "@keyframes rvsPing{0%{transform:scale(1);opacity:.7}80%,100%{transform:scale(2.4);opacity:0}}" }} />

      {/* STAT HEADER */}
      <div style={{ display: "flex", borderBottom: "1px solid #1b212b" }}>
        <div style={{ flex: 1, padding: "16px 24px", borderRight: "1px solid #1b212b" }}>
          <div style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773" })}>TOTAL ENTRIES</div>
          <div style={mono({ fontSize: 26, fontWeight: 700, color: "#e8edf2", marginTop: 4 })}>2,847</div>
          <div style={{ fontSize: 10, color: "#5c6773", marginTop: 2 }}>immutable on-chain records</div>
        </div>
        <div style={{ flex: 1, padding: "16px 24px", borderRight: "1px solid #1b212b" }}>
          <div style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773" })}>VERIFIED HASHES</div>
          <div style={mono({ fontSize: 26, fontWeight: 700, color: GREEN, marginTop: 4 })}>2,831</div>
          <div style={{ fontSize: 10, color: "#5c6773", marginTop: 2 }}>SHA-256 match rate 100%</div>
        </div>
        <div style={{ flex: 1, padding: "16px 24px", borderRight: "1px solid #1b212b" }}>
          <div style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773" })}>PENDING ANCHOR</div>
          <div style={mono({ fontSize: 26, fontWeight: 700, color: AMBER, marginTop: 4 })}>14</div>
          <div style={{ fontSize: 10, color: "#5c6773", marginTop: 2 }}>awaiting Fabric block commit</div>
        </div>
        <div style={{ flex: 1, padding: "16px 24px", background: "rgba(255,90,60,.06)" }}>
          <div style={mono({ fontSize: 9, letterSpacing: ".16em", color: RED, display: "flex", alignItems: "center", gap: 7 })}>
            <span style={{ position: "relative", display: "flex", width: 6, height: 6 }}>
              <span style={{ position: "absolute", width: 6, height: 6, borderRadius: "50%", background: RED, animation: "rvsPing 1.4s infinite" }} />
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: RED }} />
            </span>
            TAMPERED EVIDENCE
          </div>
          <div style={mono({ fontSize: 26, fontWeight: 700, color: RED, marginTop: 4 })}>2</div>
          <div style={{ fontSize: 10, color: RED, marginTop: 2 }}>hash mismatch detected</div>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* LEDGER TABLE */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px", borderBottom: "1px solid #12161d" }}>
            <span style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773" })}>HYPERLEDGER FABRIC · BLOCKCHAIN LEDGER</span>
            <span style={mono({ fontSize: 9, letterSpacing: ".08em", color: GREEN, display: "flex", alignItems: "center", gap: 6 })}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: GREEN }} />CONSENSUS HEALTHY · RAFT
            </span>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "0 24px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ height: 34, borderBottom: "1px solid #232b37" }}>
                  <th style={th}>ID</th>
                  <th style={th}>FILENAME</th>
                  <th style={th}>SHA-256</th>
                  <th style={th}>BLOCK</th>
                  <th style={th}>STATUS</th>
                  <th style={th}>ACCESSED BY</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map((row) => {
                  const isSelected = selectedRow.fileId === row.fileId;
                  const isTampered = row.status === "TAMPERED";
                  const stFg = isTampered ? RED : row.status === "VERIFIED" ? GREEN : AMBER;
                  const mark = isTampered ? "✕" : row.status === "VERIFIED" ? "✓" : "◌";
                  return (
                    <tr
                      key={row.fileId}
                      onClick={() => setSelectedRow(row)}
                      style={{
                        height: 42,
                        borderBottom: "1px solid #12161d",
                        cursor: "pointer",
                        background: isTampered ? "rgba(255,90,60,.05)" : isSelected ? hexA(AC, 0.06) : "transparent",
                        borderLeft: `2px solid ${isTampered ? RED : isSelected ? AC : "transparent"}`,
                      }}
                    >
                      <td style={mono({ padding: "0 8px", fontSize: 10, color: "#5c6773" })}>{row.fileId.toUpperCase()}</td>
                      <td style={{ padding: "0 8px", fontSize: 12, fontWeight: 600, color: "#e8edf2" }}>{row.filename}</td>
                      <td style={mono({ padding: "0 8px", fontSize: 10, color: "#5c6773" })}>
                        {row.sha256.substring(0, 14)}…{row.sha256.substring(58)}
                      </td>
                      <td style={mono({ padding: "0 8px", fontSize: 10, color: AC })}>#{row.blockNumber}</td>
                      <td style={{ padding: "0 8px" }}>
                        <span style={mono({ fontSize: 9, letterSpacing: ".12em", color: stFg })}>{mark} {row.status}</span>
                      </td>
                      <td style={{ padding: "0 8px", fontSize: 11, color: "#98a4b3" }}>{row.accessedBy}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 8px", ...mono({ fontSize: 9 }), letterSpacing: ".12em", color: "#5c6773" }}>
              <span>5 OF 2,847 COMMITTED BLOCKS</span>
              <span>SYNC DELAY 12MS</span>
            </div>
          </div>
        </div>

        {/* VERIFICATION INSPECTOR */}
        <div style={{ width: 330, borderLeft: "1px solid #1b212b", background: "#080b0e", padding: 18, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", flexShrink: 0, boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773" })}>VERIFICATION INSPECTOR</span>
            <span
              style={mono({
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: ".12em",
                padding: "3px 8px",
                background: selTam ? RED : "rgba(94,207,154,.1)",
                color: selTam ? "#060809" : GREEN,
                border: `1px solid ${selTam ? RED : "rgba(94,207,154,.35)"}`,
              })}
            >
              {selectedRow.status}
            </span>
          </div>

          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#e8edf2" }}>{selectedRow.filename}</div>
            <div style={mono({ fontSize: 10, color: "#5c6773", marginTop: 3 })}>{selectedRow.size} · BLOCK #{selectedRow.blockNumber}</div>
          </div>

          <div style={{ border: "1px solid #1b212b", background: "#060809", padding: 13, display: "flex", flexDirection: "column", gap: 11 }}>
            <div style={mono({ fontSize: 8, letterSpacing: ".18em", color: "#5c6773" })}>SHA-256 COMPARISON</div>
            <div>
              <div style={mono({ fontSize: 8, letterSpacing: ".1em", color: "#5c6773", marginBottom: 3 })}>LEDGER ANCHOR</div>
              <div style={mono({ fontSize: 10, color: GREEN, wordBreak: "break-all", lineHeight: 1.5 })}>{selectedRow.sha256}</div>
            </div>
            <div>
              <div style={mono({ fontSize: 8, letterSpacing: ".1em", color: "#5c6773", marginBottom: 3 })}>CURRENT STORAGE</div>
              <div style={mono({ fontSize: 10, wordBreak: "break-all", lineHeight: 1.5, color: selTam ? RED : GREEN, fontWeight: selTam ? 700 : 400 })}>
                {selTam
                  ? "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 (MISMATCH)"
                  : selectedRow.sha256}
              </div>
            </div>
          </div>

          <div>
            <div style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773", marginBottom: 10 })}>CHAIN OF CUSTODY</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11, borderLeft: "1px solid #232b37", paddingLeft: 14 }}>
              {[
                ["Ingested & Stored", "2024-08-28 14:30:00 · IO A. KUMAR"],
                ["SHA-256 On-Chain Anchor", `2024-08-28 14:30:02 · BLOCK #${selectedRow.blockNumber}`],
                ["NER Extraction Run", "2024-08-28 14:31:15 · OLLAMA PHI-3"],
              ].map(([title, meta]) => (
                <div key={title} style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: -17, top: 4, width: 5, height: 5, background: AC }} />
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#e8edf2" }}>{title}</div>
                  <div style={mono({ fontSize: 9, color: "#5c6773", marginTop: 2 })}>{meta}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
