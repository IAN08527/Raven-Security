import { Fragment, useEffect, useState } from "react";
import {
  downloadAuditCsv,
  fetchAuditRows,
  isMockEndorsement,
  verifyAuditRow,
  type AuditFilters,
  type AuditRow,
  type VerifyResult,
} from "../../lib/audit";

// Forensic auditor view (M5-T3, FR-7.5, design screens 13/Audit Logs).
// Read-only: lists audit rows for one case with timestamp, user badge,
// action, object type/id, ledger tx and status. Verify shows both hashes
// plus endorsements. Tampered rows carry a red left border AND a
// TAMPERED label (design §34: never color alone). Mock endorsements get
// the amber MOCK LEDGER badge instead of green org chips (D22). Row
// expand uses a 180ms transition; nothing else animates (§25).

function Endorsements({ result }: { result: VerifyResult }): JSX.Element {
  const mock = result.endorsements.some(isMockEndorsement);
  if (mock) {
    return <span className="border border-amber-600 px-1 text-xs text-amber-400">MOCK LEDGER</span>;
  }
  return (
    <span className="flex gap-1">
      {result.endorsements.map((entry) => (
        <span key={entry.org} className="border border-green-700 px-1 text-xs text-green-400">
          {entry.org}
        </span>
      ))}
    </span>
  );
}

function RowDetail({ caseId, row }: { caseId: string; row: AuditRow }): JSX.Element {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setResult(await verifyAuditRow(caseId, row.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-neutral-800 px-3 py-2 text-xs">
      {!result && !error ? (
        <button
          type="button"
          onClick={verify}
          disabled={busy}
          className="border border-neutral-600 px-2 py-0.5 disabled:opacity-50"
        >
          {busy ? "Verifying…" : "Verify"}
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      ) : null}
      {result ? (
        <div className="flex flex-col gap-1">
          <span>
            Stored hash: <code>{result.stored_hash}</code>
          </span>
          <span>
            Ledger hash: <code>{result.ledger_hash ?? "(no anchor)"}</code>
          </span>
          {result.tampered ? (
            <span className="border-l-4 border-red-500 pl-2 font-semibold text-red-400">TAMPERED</span>
          ) : (
            <span className="text-green-400">Verified</span>
          )}
          <Endorsements result={result} />
        </div>
      ) : null}
    </div>
  );
}

export function AuditPane({ caseId }: { caseId: string }): JSX.Element {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filters, setFilters] = useState<AuditFilters>({});

  useEffect(() => {
    let cancelled = false;
    fetchAuditRows(caseId, filters)
      .then((loaded) => {
        if (!cancelled) {
          setRows(loaded);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load audit rows.");
        }
      });
    return () => {
      cancelled = true;
    };
    // Re-query when the case or any filter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, filters.from, filters.to, filters.user, filters.action, filters.tamper]);

  function set<K extends keyof AuditFilters>(key: K, value: AuditFilters[K]): void {
    setFilters((previous) => ({ ...previous, [key]: value || undefined }));
  }

  return (
    <section aria-label="Audit log" className="flex flex-col gap-3 p-4 text-neutral-200">
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-1">
          From
          <input
            aria-label="From date"
            type="datetime-local"
            className="border border-neutral-700 bg-neutral-900 px-1 py-0.5"
            onChange={(event) => set("from", event.target.value ? new Date(event.target.value).toISOString() : undefined)}
          />
        </label>
        <label className="flex flex-col gap-1">
          To
          <input
            aria-label="To date"
            type="datetime-local"
            className="border border-neutral-700 bg-neutral-900 px-1 py-0.5"
            onChange={(event) => set("to", event.target.value ? new Date(event.target.value).toISOString() : undefined)}
          />
        </label>
        <label className="flex flex-col gap-1">
          User
          <input
            aria-label="Filter by user"
            type="text"
            placeholder="user id"
            className="border border-neutral-700 bg-neutral-900 px-1 py-0.5"
            onChange={(event) => set("user", event.target.value || undefined)}
          />
        </label>
        <label className="flex flex-col gap-1">
          Action
          <input
            aria-label="Filter by action"
            type="text"
            placeholder="candidate.confirm"
            className="border border-neutral-700 bg-neutral-900 px-1 py-0.5"
            onChange={(event) => set("action", event.target.value || undefined)}
          />
        </label>
        <label className="flex flex-col gap-1">
          Tamper state
          <select
            aria-label="Filter by tamper state"
            className="border border-neutral-700 bg-neutral-900 px-1 py-0.5"
            defaultValue=""
            onChange={(event) => {
              const value = event.target.value;
              set("tamper", value === "" ? undefined : (value as AuditFilters["tamper"]));
            }}
          >
            <option value="">all</option>
            <option value="verified">verified</option>
            <option value="tampered">tampered</option>
            <option value="pending">pending</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void downloadAuditCsv(caseId, filters)}
          className="border border-neutral-600 px-2 py-0.5"
        >
          Export CSV
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-neutral-700 text-neutral-400">
            <th className="px-2 py-1">Timestamp</th>
            <th className="px-2 py-1">User</th>
            <th className="px-2 py-1">Action</th>
            <th className="px-2 py-1">Object</th>
            <th className="px-2 py-1">Ledger tx</th>
            <th className="px-2 py-1">Ledger status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const open = expanded === row.id;
            return (
              <Fragment key={row.id}>
                <tr
                  onClick={() => setExpanded(open ? null : row.id)}
                  className="cursor-pointer border-b border-neutral-800 hover:bg-neutral-900"
                >
                  <td className="px-2 py-1">{row.created_at}</td>
                  <td className="px-2 py-1">
                    {row.user_id} ({row.user_role})
                  </td>
                  <td className="px-2 py-1">{row.action}</td>
                  <td className="px-2 py-1">
                    {row.object_type}:{row.object_id}
                  </td>
                  <td className="px-2 py-1">{row.ledger_tx_id ?? "—"}</td>
                  <td className="px-2 py-1">{row.ledger_status}</td>
                </tr>
                {open ? (
                  <tr>
                    <td colSpan={6} className="p-0">
                      <div className="grid transition-all duration-[180ms]">
                        <RowDetail caseId={caseId} row={row} />
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && !error ? <p className="text-sm text-neutral-400">No audit rows match the current filters.</p> : null}
    </section>
  );
}
