// Case lifecycle calls (API_CONTRACTS.md §2.1, D21).
// Self-contained session handling like lib/admin.ts: creation and
// assignment are admin-only; listing and detail are assigned-roles
// only. The server enforces both boundaries.

import { getSession } from "./session";
import type { CaseDetailResponse, CaseRecord } from "../types/api";

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

async function check(response: Response): Promise<Response> {
  if (response.status === 401) {
    throw new Error("Session expired. Sign in again.");
  }
  if (response.status === 403) {
    throw new Error("Not permitted for your role or assignment.");
  }
  if (response.status === 404) {
    throw new Error("Case not found.");
  }
  if (response.status === 409) {
    throw new Error("Case code already open.");
  }
  if (!response.ok) {
    throw new Error(`Case request failed (status ${response.status}).`);
  }
  return response;
}

/** Cases the signed-in user is assigned to, in case-code order. */
export async function listCases(): Promise<CaseRecord[]> {
  const response = await fetch(`${serverBase()}/v1/cases`, { headers: authHeaders() });
  return (await check(response)).json() as Promise<CaseRecord[]>;
}

/** Open a case (admin only). */
export async function createCase(input: { case_code: string; title: string }): Promise<CaseRecord> {
  const response = await fetch(`${serverBase()}/v1/cases`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await check(response)).json() as Promise<CaseRecord>;
}

/** Case detail plus assignment roster (assigned callers only). */
export async function getCase(id: string): Promise<CaseDetailResponse> {
  const response = await fetch(`${serverBase()}/v1/cases/${id}`, { headers: authHeaders() });
  return (await check(response)).json() as Promise<CaseDetailResponse>;
}
