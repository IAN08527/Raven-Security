// Movement timeline and routine calls (API_CONTRACTS.md §2.7, FR-6).
// Self-contained session handling like lib/audit.ts: the server
// enforces assignment + role.

import { getSession } from "./session";
import type { MovementTimeline, RoutineResponse } from "../types/api";

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
  if (!response.ok) {
    throw new Error(`Movement request failed (status ${response.status}).`);
  }
  return response;
}

export interface TimelineParams {
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export async function fetchMovementTimeline(
  entityId: string,
  params: TimelineParams = {},
): Promise<MovementTimeline> {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  const suffix = query.toString();
  const response = await fetch(
    `${serverBase()}/v1/entities/${entityId}/timeline${suffix ? `?${suffix}` : ""}`,
    { headers: authHeaders() },
  );
  return (await check(response)).json() as Promise<MovementTimeline>;
}

export async function fetchRoutine(entityId: string): Promise<RoutineResponse> {
  const response = await fetch(`${serverBase()}/v1/entities/${entityId}/routine`, {
    headers: authHeaders(),
  });
  return (await check(response)).json() as Promise<RoutineResponse>;
}
