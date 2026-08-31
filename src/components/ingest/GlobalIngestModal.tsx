import { useState, useRef } from "react";
import { useCaseStore } from "../../store/case";
import { DATA_CATEGORIES, PIPELINE_STAGES } from "../../dev/mockDatabases";
import type { IngestionOutcome } from "../../dev/dynamicIngest";

const M_AC = "#e8c15a";
const m_hexA = (h: string, a: number) => h + Math.round(a * 255).toString(16).padStart(2, "0");
const M_MONO = "'Spline Sans Mono',monospace";

const PRESET_FINANCIAL_CSV = `from_account,to_account,amount,method,date,remarks
HDFC-0928172,ICICI-8819201,450000,RTGS,2026-08-14,Hawala layer 1
ICICI-8819201,SBI-4401928,320000,NEFT,2026-08-15,Syndicate settlement
SBI-4401928,AXIS-1192837,180000,UPI,2026-08-16,Cash mule withdrawal
AXIS-1192837,KOTAK-992810,75000,IMPS,2026-08-17,Field logistics`;

const PRESET_FIR_TEXT = `FIRST INFORMATION REPORT (Under Section 154 Cr.P.C.)
FIR No: FIR-102/2026
Police Station: Cyber-Crime PS, Special Cell
Date of Incident: 2026-08-14 22:30 IST
Under Sections: Sec 420, 406, 120B IPC r/w IT Act 66D
Accused Persons: Rakesh Sawant (Alias: Ricky), Vikram Patel (Hawala Operator), Mohd. Khan (Logistics Coordinator), QuickPay Solutions Pvt Ltd
Contact Numbers: +91 98765 43210, +91 98111 22334
Suspect Vehicles: MH02AB1234, MH01CD5678
Summary: Syndicate orchestrated large-scale financial extortion and unauthorized crypto-hawala settlements across multiple shell corporate accounts.`;

const PRESET_CDR_CSV = `caller_msisdn,callee_msisdn,duration,call_type,cell_tower,timestamp
+919876543210,+919811122334,340s,VOICE,MH-MUM-0847,2026-08-14 21:12:00
+919811122334,+919922244556,120s,VOICE,MH-MUM-0192,2026-08-14 21:25:30
+919922244556,+919833366778,85s,VOICE,MH-MUM-0441,2026-08-14 21:40:15
+919876543210,+919844488990,410s,VOICE,MH-MUM-0847,2026-08-14 22:05:00`;

export function GlobalIngestModal() {
  const isIngestModalOpen = useCaseStore((s) => s.isIngestModalOpen);
  const closeIngestModal = useCaseStore((s) => s.closeIngestModal);
  const scanFile = useCaseStore((s) => s.scanFile);
  const commitSelectedCandidates = useCaseStore((s) => s.commitSelectedCandidates);
  const openTab = useCaseStore((s) => s.openTab);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [customText, setCustomText] = useState<string>("");
  const [customName, setCustomName] = useState<string>("");
  const [category, setCategory] = useState<string>("financial");
  const [stage, setStage] = useState<"pick" | "scanning" | "review" | "done">("pick");
  const [activeStageIdx, setActiveStageIdx] = useState(0);
  const [outcome, setOutcome] = useState<IngestionOutcome | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [isDragging, setIsDragging] = useState(false);
  const [commitSummary, setCommitSummary] = useState<{
    savedSuspects: number;
    savedNodes: number;
    savedEdges: number;
    savedRows: number;
  } | null>(null);

  if (!isIngestModalOpen) return null;

  const fileName = file?.name || customName || "";
  const cat = DATA_CATEGORIES.find((c) => c.id === category) || DATA_CATEGORIES[0];

  const handleFileChange = (f: File | null) => {
    if (f) {
      setFile(f);
      setCustomText("");
      setCustomName(f.name);
      setOutcome(null);
      setStage("pick");
      setActiveStageIdx(0);
    }
  };

  const loadPreset = (type: "financial" | "fir" | "cdr") => {
    if (type === "financial") {
      setFile(null);
      setCustomName("hawala_settlement_ledger.csv");
      setCustomText(PRESET_FINANCIAL_CSV);
      setCategory("financial");
    } else if (type === "fir") {
      setFile(null);
      setCustomName("fir_102_special_cell_crime.txt");
      setCustomText(PRESET_FIR_TEXT);
      setCategory("case");
    } else if (type === "cdr") {
      setFile(null);
      setCustomName("call_records_batch_0847.csv");
      setCustomText(PRESET_CDR_CSV);
      setCategory("telecom");
    }
    setOutcome(null);
    setStage("pick");
  };

  const startScan = async () => {
    // If user clicked start without picking anything, auto-load financial sample
    let targetName = fileName;
    let targetText = customText;
    let targetFile = file;

    if (!targetName && !targetFile) {
      targetName = "hawala_settlement_ledger.csv";
      targetText = PRESET_FINANCIAL_CSV;
      setCustomName(targetName);
      setCustomText(targetText);
    }

    setStage("scanning");
    setActiveStageIdx(0);

    let textContent = targetText;
    if (targetFile && !textContent) {
      try {
        textContent = await targetFile.text();
      } catch {
        textContent = "";
      }
    }

    let i = 0;
    const tick = window.setInterval(async () => {
      i += 1;
      if (i >= PIPELINE_STAGES.length) {
        window.clearInterval(tick);
        try {
          const res = await scanFile({
            file: targetFile || undefined,
            name: targetName || "investigative_dataset.csv",
            text: textContent,
            category,
            byteSize: targetFile ? targetFile.size : textContent.length,
          });
          setOutcome(res);
          setSelectedCandidateIds(new Set(res.candidates.map((c) => c.id)));
          setStage("review");
        } catch (err) {
          console.error("Scan error:", err);
          setStage("pick");
        }
      } else {
        setActiveStageIdx(i);
      }
    }, 240);
  };

  const toggleCandidate = (id: string) => {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (!outcome) return;
    setSelectedCandidateIds(new Set(outcome.candidates.map((c) => c.id)));
  };

  const deselectAll = () => {
    setSelectedCandidateIds(new Set());
  };

  const handleCommit = () => {
    if (!outcome) return;
    const summary = commitSelectedCandidates(outcome, selectedCandidateIds);
    setCommitSummary(summary);
    setStage("done");
  };

  const handleReset = () => {
    setFile(null);
    setCustomText("");
    setCustomName("");
    setOutcome(null);
    setStage("pick");
    setActiveStageIdx(0);
    setSelectedCandidateIds(new Set());
    setCommitSummary(null);
  };

  const displayedCandidates = (outcome?.candidates || []).filter((c) => {
    if (filterCategory === "all") return true;
    if (filterCategory === "suspect") return c.category === "suspect";
    if (filterCategory === "entities") return ["account", "vehicle", "organization"].includes(c.category);
    if (filterCategory === "relationships") return c.category === "relationship";
    if (filterCategory === "rows") return c.category === "dataset_row";
    return true;
  });

  return (
    <div
      onClick={closeIngestModal}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(4,6,8,.85)",
        backdropFilter: "blur(6px)",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: stage === "review" ? 780 : 600,
          maxWidth: "100%",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          border: `1px solid ${m_hexA(M_AC, 0.45)}`,
          background: "#080b0e",
          boxShadow: "0 25px 70px rgba(0,0,0,.9)",
          fontFamily: "'Instrument Sans',system-ui,sans-serif",
          color: "#e8edf2",
          overflow: "hidden",
        }}
      >
        {/* Hidden native file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.pdf,.txt,.json,.tsv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileChange(f);
          }}
        />

        {/* Modal Header */}
        <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #1b212b", background: "#0b0e12" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ display: "flex", height: 28, width: 28, alignItems: "center", justifyContent: "center", borderRadius: "50%", background: m_hexA(M_AC, 0.15), color: M_AC, fontSize: 13, fontWeight: 700 }}>
              {stage === "done" ? "✓" : stage === "review" ? "⚖" : "↑"}
            </span>
            <div>
              <h2 style={{ margin: 0, fontFamily: M_MONO, fontSize: 12, fontWeight: 700, letterSpacing: ".14em", color: M_AC }}>
                {stage === "review"
                  ? "SELECTIVE DATA REVIEW & DATABASE COMMIT"
                  : stage === "done"
                  ? "DATA COMMITTED TO VERIFIED REPOSITORY"
                  : "INGEST ARTIFACT & MULTI-LAYER SCAN"}
              </h2>
              <div style={{ fontSize: 10, color: "#5c6773", marginTop: 2 }}>
                {stage === "review"
                  ? "Select precisely which suspect profiles, graph nodes, and dataset records to store in database."
                  : "Forensic Extraction · SHA-256 WebCrypto · On-Chain Anchor"}
              </div>
            </div>
          </div>
          <button
            onClick={closeIngestModal}
            style={{ background: "none", border: "none", color: "#5c6773", cursor: "pointer", fontSize: 18, fontFamily: "inherit" }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: "18px 20px", overflowY: "auto", flex: 1 }}>
          {/* STAGE 1: PICK FILE / PRESET */}
          {stage === "pick" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Drop / Browse Area */}
              <div>
                <label style={{ display: "block", marginBottom: 6, fontFamily: M_MONO, fontSize: 9, letterSpacing: ".12em", color: "#98a4b3" }}>
                  SELECT INVESTIGATIVE FILE (OR DRAG & DROP)
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleFileChange(f);
                  }}
                  style={{
                    display: "flex",
                    cursor: "pointer",
                    alignItems: "center",
                    justifyContent: "space-between",
                    border: `1px dashed ${isDragging ? M_AC : fileName ? M_AC : "#232b37"}`,
                    background: isDragging ? m_hexA(M_AC, 0.05) : "#0b0e12",
                    padding: "16px",
                    fontSize: 12,
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <span style={{ color: fileName ? M_AC : "#5c6773", fontSize: 20 }}>
                      {fileName ? "📄" : "📁"}
                    </span>
                    <div>
                      <div style={{ color: fileName ? "#e8edf2" : "#98a4b3", fontWeight: fileName ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {fileName || "Click to browse local files or drop .csv / .pdf / .txt here"}
                      </div>
                      <div style={{ fontSize: 10, color: "#5c6773", marginTop: 2 }}>
                        {fileName ? (file ? `${(file.size / 1024).toFixed(1)} KB loaded` : "Preset dataset loaded") : "Supported: CSV, PDF, TXT, JSON, FIR"}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    style={{
                      border: `1px solid ${m_hexA(M_AC, 0.4)}`,
                      background: "#080b0e",
                      padding: "6px 14px",
                      fontFamily: M_MONO,
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: ".08em",
                      color: M_AC,
                      cursor: "pointer",
                    }}
                  >
                    BROWSE
                  </button>
                </div>
              </div>

              {/* One-Click Presets */}
              <div>
                <label style={{ display: "block", marginBottom: 6, fontFamily: M_MONO, fontSize: 9, letterSpacing: ".12em", color: "#98a4b3" }}>
                  OR QUICK-LOAD FORENSIC SAMPLE DATASETS
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => loadPreset("financial")}
                    style={{
                      padding: "8px 10px",
                      background: fileName.includes("hawala") ? m_hexA(M_AC, 0.15) : "#0b0e12",
                      border: `1px solid ${fileName.includes("hawala") ? M_AC : "#1b212b"}`,
                      color: fileName.includes("hawala") ? M_AC : "#e8edf2",
                      textAlign: "left",
                      cursor: "pointer",
                      fontSize: 11,
                    }}
                  >
                    <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                      <span>💰</span> Financial CSV
                    </div>
                    <div style={{ fontSize: 9, color: "#5c6773", marginTop: 2 }}>Hawala bank accounts</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => loadPreset("fir")}
                    style={{
                      padding: "8px 10px",
                      background: fileName.includes("fir_102") ? m_hexA(M_AC, 0.15) : "#0b0e12",
                      border: `1px solid ${fileName.includes("fir_102") ? M_AC : "#1b212b"}`,
                      color: fileName.includes("fir_102") ? M_AC : "#e8edf2",
                      textAlign: "left",
                      cursor: "pointer",
                      fontSize: 11,
                    }}
                  >
                    <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                      <span>⚖</span> FIR Incident Text
                    </div>
                    <div style={{ fontSize: 9, color: "#5c6773", marginTop: 2 }}>Accused & legal IPC</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => loadPreset("cdr")}
                    style={{
                      padding: "8px 10px",
                      background: fileName.includes("call_records") ? m_hexA(M_AC, 0.15) : "#0b0e12",
                      border: `1px solid ${fileName.includes("call_records") ? M_AC : "#1b212b"}`,
                      color: fileName.includes("call_records") ? M_AC : "#e8edf2",
                      textAlign: "left",
                      cursor: "pointer",
                      fontSize: 11,
                    }}
                  >
                    <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                      <span>📞</span> Telecom CDR
                    </div>
                    <div style={{ fontSize: 9, color: "#5c6773", marginTop: 2 }}>Caller MSISDN logs</div>
                  </button>
                </div>
              </div>

              {/* Data Category */}
              <div>
                <label style={{ display: "block", marginBottom: 6, fontFamily: M_MONO, fontSize: 9, letterSpacing: ".12em", color: "#98a4b3" }}>
                  TARGET DATA SCHEMA & ROUTING
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  style={{
                    height: 36,
                    width: "100%",
                    background: "#0b0e12",
                    border: "1px solid #1b212b",
                    padding: "0 10px",
                    fontSize: 12,
                    color: "#e8edf2",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                >
                  {DATA_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} — {c.hint} (Target: {c.target})
                    </option>
                  ))}
                </select>
                <div style={{ marginTop: 4, fontSize: 10, color: "#5c6773" }}>
                  Routes into <span style={{ fontFamily: M_MONO, color: "#98a4b3" }}>{cat.target}</span>. Extracted items can be reviewed and filtered before saving.
                </div>
              </div>
            </div>
          )}

          {/* STAGE 2: SCANNING PROGRESS */}
          {stage === "scanning" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontFamily: M_MONO, fontSize: 11, color: M_AC, marginBottom: 4 }}>
                SCANNING & FORENSIC DECOMPOSITION: {fileName || "dataset"}
              </div>
              <div style={{ border: "1px solid #1b212b", background: "#0b0e12", padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                {PIPELINE_STAGES.map((st, idx) => {
                  const done = idx < activeStageIdx;
                  const current = idx === activeStageIdx;
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
                        {done ? "✓" : current ? "…" : idx + 1}
                      </span>
                      <span style={{ color: done || current ? "#e8edf2" : "#5c6773" }}>{st.label}</span>
                      <span style={{ marginLeft: "auto", fontFamily: M_MONO, fontSize: 9, color: "#5c6773" }}>{st.detail}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STAGE 3: SELECTIVE REVIEW CANDIDATES */}
          {stage === "review" && outcome && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Review Sub-Header & Controls */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, paddingBottom: 8, borderBottom: "1px solid #1b212b" }}>
                <div style={{ fontSize: 12 }}>
                  Extracted <span style={{ fontWeight: 700, color: M_AC }}>{outcome.candidates.length} candidate items</span> from <span className="font-mono text-white">{outcome.fileName}</span>
                  <div style={{ fontSize: 10, color: "#5ecf9a", marginTop: 2 }}>
                    Selected {selectedCandidateIds.size} of {outcome.candidates.length} items to save to Database
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={selectAll}
                    style={{ height: 26, padding: "0 10px", background: "#0b0e12", border: "1px solid #1b212b", color: "#98a4b3", fontFamily: M_MONO, fontSize: 10, cursor: "pointer" }}
                  >
                    SELECT ALL
                  </button>
                  <button
                    type="button"
                    onClick={deselectAll}
                    style={{ height: 26, padding: "0 10px", background: "#0b0e12", border: "1px solid #1b212b", color: "#5c6773", fontFamily: M_MONO, fontSize: 10, cursor: "pointer" }}
                  >
                    DESELECT ALL
                  </button>
                </div>
              </div>

              {/* Filter Tabs */}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {[
                  { id: "all", label: `ALL (${outcome.candidates.length})` },
                  { id: "suspect", label: `SUSPECTS (${outcome.newSuspects.length})` },
                  { id: "entities", label: `ACCOUNTS & VEHICLES (${outcome.newNodes.filter((n) => n.data.type !== "PERSON").length})` },
                  { id: "relationships", label: `RELATIONSHIPS (${outcome.newEdges.length})` },
                  { id: "rows", label: `DATASET ROWS (${outcome.parsedRows.length})` },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilterCategory(f.id)}
                    style={{
                      height: 26,
                      padding: "0 10px",
                      background: filterCategory === f.id ? m_hexA(M_AC, 0.15) : "#0b0e12",
                      border: `1px solid ${filterCategory === f.id ? M_AC : "#1b212b"}`,
                      color: filterCategory === f.id ? M_AC : "#5c6773",
                      fontFamily: M_MONO,
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* Candidates List with Checkboxes */}
              <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid #1b212b", background: "#060809" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: "#0b0e12", borderBottom: "1px solid #1b212b", height: 30 }}>
                      <th style={{ width: 36, textAlign: "center", padding: "0 6px" }}>
                        <input
                          type="checkbox"
                          checked={selectedCandidateIds.size === outcome.candidates.length}
                          onChange={(e) => (e.target.checked ? selectAll() : deselectAll())}
                          style={{ cursor: "pointer", accentColor: M_AC }}
                        />
                      </th>
                      <th style={{ width: 90, padding: "0 8px", fontFamily: M_MONO, fontSize: 9, color: "#5c6773" }}>TYPE</th>
                      <th style={{ padding: "0 8px", fontFamily: M_MONO, fontSize: 9, color: "#5c6773" }}>EXTRACTED RECORD / ENTITY</th>
                      <th style={{ padding: "0 8px", fontFamily: M_MONO, fontSize: 9, color: "#5c6773" }}>EVIDENCE DETAILS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedCandidates.map((cand) => {
                      const isChecked = selectedCandidateIds.has(cand.id);
                      const isSuspect = cand.category === "suspect";
                      return (
                        <tr
                          key={cand.id}
                          onClick={() => toggleCandidate(cand.id)}
                          style={{
                            height: 38,
                            borderBottom: "1px solid #12161d",
                            cursor: "pointer",
                            background: isChecked ? m_hexA(M_AC, 0.04) : "transparent",
                          }}
                        >
                          <td style={{ textAlign: "center", padding: "0 6px" }} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleCandidate(cand.id)}
                              style={{ cursor: "pointer", accentColor: M_AC }}
                            />
                          </td>
                          <td style={{ padding: "0 8px" }}>
                            <span
                              style={{
                                fontFamily: M_MONO,
                                fontSize: 9,
                                fontWeight: 700,
                                padding: "2px 6px",
                                borderRadius: 2,
                                background: isSuspect ? "rgba(255,90,60,.15)" : "#1b212b",
                                color: isSuspect ? "#ff5a3c" : M_AC,
                              }}
                            >
                              {cand.badge}
                            </span>
                          </td>
                          <td style={{ padding: "0 8px", fontWeight: isSuspect ? 700 : 500, color: isSuspect ? "#e8edf2" : "#98a4b3" }}>
                            {cand.label}
                          </td>
                          <td style={{ padding: "0 8px", fontFamily: M_MONO, fontSize: 10, color: "#5c6773" }}>
                            {cand.detail}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* STAGE 4: DONE & CONFIRMED */}
          {stage === "done" && commitSummary && outcome && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ border: "1px solid rgba(94,207,154,.3)", background: "rgba(94,207,154,.05)", padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#5ecf9a", fontWeight: 700, fontSize: 13 }}>
                  <span>✓</span>
                  <span>Data Stored In Database & Synchronized Across Modules</span>
                </div>
                <div style={{ fontSize: 11, color: "#98a4b3", marginTop: 4 }}>
                  Artifact <strong className="text-white">{outcome.fileName}</strong> anchored on Hyperledger Fabric block #{outcome.blockNumber}.
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, textAlign: "center" }}>
                <div style={{ border: "1px solid #1b212b", background: "#0b0e12", padding: "10px 4px" }}>
                  <div style={{ fontFamily: M_MONO, fontSize: 18, fontWeight: 700, color: "#ff5a3c" }}>{commitSummary.savedSuspects}</div>
                  <div style={{ fontSize: 9, color: "#5c6773", marginTop: 2 }}>Suspect Profiles</div>
                </div>
                <div style={{ border: "1px solid #1b212b", background: "#0b0e12", padding: "10px 4px" }}>
                  <div style={{ fontFamily: M_MONO, fontSize: 18, fontWeight: 700, color: M_AC }}>{commitSummary.savedNodes}</div>
                  <div style={{ fontSize: 9, color: "#5c6773", marginTop: 2 }}>Graph Nodes</div>
                </div>
                <div style={{ border: "1px solid #1b212b", background: "#0b0e12", padding: "10px 4px" }}>
                  <div style={{ fontFamily: M_MONO, fontSize: 18, fontWeight: 700, color: "#5ecf9a" }}>{commitSummary.savedEdges}</div>
                  <div style={{ fontSize: 9, color: "#5c6773", marginTop: 2 }}>Network Edges</div>
                </div>
                <div style={{ border: "1px solid #1b212b", background: "#0b0e12", padding: "10px 4px" }}>
                  <div style={{ fontFamily: M_MONO, fontSize: 18, fontWeight: 700, color: "#e8edf2" }}>{commitSummary.savedRows}</div>
                  <div style={{ fontSize: 9, color: "#5c6773", marginTop: 2 }}>Dataset Rows</div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => {
                    closeIngestModal();
                    openTab({ id: "tab-profiles-dir", type: "profiles-dir", title: "Profiles Directory" });
                  }}
                  style={{
                    height: 32,
                    padding: "0 14px",
                    background: "rgba(255,90,60,.12)",
                    border: "1px solid #ff5a3c",
                    color: "#ff5a3c",
                    fontFamily: M_MONO,
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  👥 View In Suspects Roster
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeIngestModal();
                    openTab({ id: "tab-graph", type: "graph", title: "Macro Network" });
                  }}
                  style={{
                    height: 32,
                    padding: "0 14px",
                    background: m_hexA(M_AC, 0.15),
                    border: `1px solid ${M_AC}`,
                    color: M_AC,
                    fontFamily: M_MONO,
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  👁 View In Macro Graph
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeIngestModal();
                    openTab({ id: "tab-databases", type: "databases", title: "Data Sources" });
                  }}
                  style={{
                    height: 32,
                    padding: "0 14px",
                    background: "rgba(94,207,154,.12)",
                    border: "1px solid #5ecf9a",
                    color: "#5ecf9a",
                    fontFamily: M_MONO,
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  🗄 View In Database Store
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #1b212b", background: "#0b0e12" }}>
          <div>
            {stage === "review" && (
              <button
                type="button"
                onClick={handleReset}
                style={{ background: "none", border: "none", color: "#5c6773", fontFamily: M_MONO, fontSize: 11, cursor: "pointer" }}
              >
                ← Choose Another File
              </button>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={closeIngestModal}
              style={{
                height: 32,
                padding: "0 16px",
                background: "transparent",
                border: "1px solid #1b212b",
                color: "#98a4b3",
                fontFamily: M_MONO,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {stage === "done" ? "FINISH" : "CANCEL"}
            </button>

            {stage === "pick" && (
              <button
                type="button"
                onClick={startScan}
                style={{
                  height: 32,
                  padding: "0 18px",
                  background: m_hexA(M_AC, 0.2),
                  border: `1px solid ${M_AC}`,
                  color: M_AC,
                  fontFamily: M_MONO,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                START SCAN & EXTRACTION
              </button>
            )}

            {stage === "review" && (
              <button
                type="button"
                onClick={handleCommit}
                disabled={selectedCandidateIds.size === 0}
                style={{
                  height: 32,
                  padding: "0 18px",
                  background: "#5ecf9a",
                  border: "1px solid #5ecf9a",
                  color: "#060809",
                  fontFamily: M_MONO,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  opacity: selectedCandidateIds.size === 0 ? 0.4 : 1,
                }}
              >
                💾 SAVE SELECTED ({selectedCandidateIds.size}) TO DATABASE
              </button>
            )}

            {stage === "done" && (
              <button
                type="button"
                onClick={handleReset}
                style={{
                  height: 32,
                  padding: "0 18px",
                  background: m_hexA(M_AC, 0.15),
                  border: `1px solid ${M_AC}`,
                  color: M_AC,
                  fontFamily: M_MONO,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                INGEST ANOTHER ARTIFACT
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
