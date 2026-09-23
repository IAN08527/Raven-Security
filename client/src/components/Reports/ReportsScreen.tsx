import { useState } from "react";
import { AuditPane } from "../Audit/AuditPane";

// Reports & Audit (reference bottom-right, design §17/§18).
// Audit log is live via AuditPane; the reports table needs a reports
// API, so it states that instead of inventing rows (rule 10).

export function ReportsScreen(): JSX.Element {
  const [tab, setTab] = useState<"reports" | "audit">("audit");
  const [caseId, setCaseId] = useState("");

  return (
    <div className="flex h-full flex-col gap-3 bg-[#151514] p-6 text-[#E8E5DD]">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl text-[#E8E5DD]">Reports &amp; Audit</h1>
          <p className="text-sm text-[#A5A29A]">Generate reports and review system audit logs.</p>
        </div>
        <button
          type="button"
          disabled
          title="Report generation needs a reports API (not yet served)"
          className="border border-[#30302D] bg-[#20201E] px-3 py-1 text-sm text-[#706E68]"
        >
          Generate Report
        </button>
      </header>

      <div className="flex gap-1 border-b border-[#30302D]" role="tablist" aria-label="Reports or audit">
        {(["reports", "audit"] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={`px-3 py-1.5 text-xs font-semibold ${
              tab === name ? "bg-[#262624] text-[#E8E5DD]" : "text-[#706E68] hover:text-[#A5A29A]"
            }`}
          >
            {name === "reports" ? "Reports" : "Audit Logs"}
          </button>
        ))}
      </div>

      {tab === "reports" ? (
        <section aria-label="Reports" className="border border-[#30302D] bg-[#1B1B19] p-3">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#30302D] text-[#A5A29A]">
                <th className="px-2 py-1">Timestamp</th>
                <th className="px-2 py-1">User</th>
                <th className="px-2 py-1">Action</th>
                <th className="px-2 py-1">Details</th>
                <th className="px-2 py-1">Status</th>
              </tr>
            </thead>
          </table>
          <p className="px-2 py-3 text-xs text-[#706E68]">
            No reports API yet — nothing is listed until it exists. Audit history below is live.
          </p>
        </section>
      ) : (
        <section aria-label="Audit logs" className="flex min-h-0 flex-1 flex-col gap-2">
          <label className="flex max-w-md flex-col gap-1 text-xs text-[#A5A29A]">
            Case id
            <input
              aria-label="Audit case id"
              value={caseId}
              onChange={(e) => setCaseId(e.target.value.trim())}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="border border-[#30302D] bg-[#171716] px-2 py-1 font-mono text-[#E8E5DD]"
            />
          </label>
          {caseId ? (
            <div className="min-h-0 flex-1 overflow-auto border border-[#30302D] bg-[#1B1B19]">
              <AuditPane caseId={caseId} />
            </div>
          ) : (
            <p className="text-xs text-[#706E68]">Enter a case id to review its audit log.</p>
          )}
        </section>
      )}
    </div>
  );
}
