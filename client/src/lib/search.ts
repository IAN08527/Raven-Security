// Global search calls (API_CONTRACTS.md §2.12, design §13).
// Self-contained session handling like lib/audit.ts: the server
// enforces assignment + role, so results never leak across cases.

import { getSession } from "./session";
import type { SearchResponse } from "../types/api";

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

export interface SearchParams {
  types?: string;
  caseId?: string;
  limit?: number;
}

export async function fetchSearch(query: string, params: SearchParams = {}): Promise<SearchResponse> {
  const search = new URLSearchParams({ q: query });
  if (params.types) search.set("types", params.types);
  if (params.caseId) search.set("case_id", params.caseId);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  const response = await fetch(`${serverBase()}/v1/search?${search}`, {
    headers: authHeaders(),
  });
  if (response.status === 401) {
    throw new Error("Session expired. Sign in again.");
  }
  if (!response.ok) {
    throw new Error(`Search request failed (status ${response.status}).`);
  }
  return (await response.json()) as SearchResponse;
}
