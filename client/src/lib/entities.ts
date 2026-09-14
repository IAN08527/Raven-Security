// Entity listing, detail and annotation calls (API_CONTRACTS.md §2.5).
// Self-contained session handling like lib/audit.ts: every call carries
// the in-memory session JWT; the server enforces assignment + role.

import { getSession } from "./session";
import type { EntityListResponse, EntityNote, EntityRecord } from "../types/api";

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

export interface EntitiesError extends Error {
  status: number;
  code: string;
}

async function check(response: Response): Promise<Response> {
  if (response.status === 401) {
    throw new Error("Session expired. Sign in again.");
  }
  if (!response.ok) {
    let code = "INTERNAL";
    try {
      const body = (await response.json()) as { error?: { code?: string } };
      if (body.error?.code) code = body.error.code;
    } catch {
      // Non-JSON error body: keep the default code.
    }
    const error = new Error(`Entities request failed (status ${response.status}).`) as EntitiesError;
    error.status = response.status;
    error.code = code;
    throw error;
  }
  return response;
}

export interface ListEntitiesParams {
  type?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

export async function fetchEntities(caseId: string, params: ListEntitiesParams = {}): Promise<EntityListResponse> {
  const query = new URLSearchParams();
  if (params.type) query.set("type", params.type);
  if (params.search) query.set("search", params.search);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  const suffix = query.toString();
  const response = await fetch(
    `${serverBase()}/v1/cases/${caseId}/entities${suffix ? `?${suffix}` : ""}`,
    { headers: authHeaders() },
  );
  return (await check(response)).json() as Promise<EntityListResponse>;
}

export async function fetchEntityRecord(entityId: string): Promise<EntityRecord> {
  const response = await fetch(`${serverBase()}/v1/entities/${entityId}`, {
    headers: authHeaders(),
  });
  return (await check(response)).json() as Promise<EntityRecord>;
}

export async function postEntityNote(entityId: string, text: string): Promise<EntityNote> {
  const response = await fetch(`${serverBase()}/v1/entities/${entityId}/notes`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return (await check(response)).json() as Promise<EntityNote>;
}

export interface MergeProposal {
  merge_id: number;
  status: string;
}

export async function proposeMerge(
  survivingId: string,
  mergedId: string,
  reason: string,
): Promise<MergeProposal> {
  const response = await fetch(`${serverBase()}/v1/entities/merge`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ surviving_id: survivingId, merged_id: mergedId, reason }),
  });
  return (await check(response)).json() as Promise<MergeProposal>;
}
