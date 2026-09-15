// Auditor-view data access (M5-T3, FR-7.5): read audit rows, verify one
// row against the ledger, export CSV. All calls carry the in-memory
// session JWT; the server enforces assignment + role.

import { getSession } from "./session";
import type { AuditRow, Endorsement, VerifyRowResponse as VerifyResult } from "../types/api";

// Generated types re-exported so existing `lib/audit` importers keep
// working; the wire shapes live in types/generated/ (D30).
export type { AuditRow, Endorsement, VerifyRowResponse as VerifyResult } from "../types/api";

export interface AuditFilters {
  from?: string;
  to?: string;
  user?: string;
  action?: string;
  tamper?: "verified" | "tampered" | "pending";
}

function serverBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return (env?.VITE_SERVER_URL ?? "https://localhost:8443").replace(/\/$/, "");
}

function authHeaders(): Record<string, string> {
  const session = getSession();
  if (!session) {
    throw new Error("not signed in");
  }
  return { Authorization: `Bearer ${session.token}` };
}

function queryOf(filters: AuditFilters): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.user) params.set("user", filters.user);
  if (filters.action) params.set("action", filters.action);
  if (filters.tamper) params.set("tamper", filters.tamper);
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function check(response: Response): Promise<Response> {
  if (response.status === 401) {
    throw new Error("Session expired. Sign in again.");
  }
  if (response.status === 403) {
    throw new Error("Not permitted to view this case's audit log.");
  }
  if (!response.ok) {
    throw new Error(`Audit request failed (status ${response.status}).`);
  }
  return response;
}

export async function fetchAuditRows(caseId: string, filters: AuditFilters): Promise<AuditRow[]> {
  const response = await fetch(`${serverBase()}/v1/cases/${caseId}/audit${queryOf(filters)}`, {
    headers: authHeaders(),
  });
  return (await check(response)).json() as Promise<AuditRow[]>;
}

export async function verifyAuditRow(caseId: string, rowId: string): Promise<VerifyResult> {
  const response = await fetch(`${serverBase()}/v1/cases/${caseId}/audit/${rowId}/verify`, {
    headers: authHeaders(),
  });
  return (await check(response)).json() as Promise<VerifyResult>;
}

export async function downloadAuditCsv(caseId: string, filters: AuditFilters): Promise<void> {
  const session = getSession();
  if (!session) {
    throw new Error("not signed in");
  }
  const response = await fetch(
    `${serverBase()}/v1/cases/${caseId}/audit/export${queryOf(filters)}`,
    { headers: authHeaders() }
  );
  await check(response);
  const text = await response.text();
  const blob = new Blob([text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `audit-${caseId}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** True when the endorsement came from the dev ledger (amber badge). */
export function isMockEndorsement(endorsement: Endorsement): boolean {
  return endorsement.mode === "mock";
}
