// Case timeline calls (API_CONTRACTS.md §2.10).
// Self-contained session handling like lib/audit.ts: the server
// enforces assignment + role. CSV export is client-side, generated
// from the fetched events — there is no server timeline-export route.

import { getSession } from "./session";
import type { CaseTimeline } from "../types/api";

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

export interface TimelineParams {
  type?: string;
  entityId?: string;
  from?: string;
  to?: string;
  order?: "asc" | "desc";
  limit?: number;
  cursor?: string;
}

export async function fetchCaseTimeline(
  caseId: string,
  params: TimelineParams = {},
): Promise<CaseTimeline> {
  const query = new URLSearchParams();
  if (params.type) query.set("type", params.type);
  if (params.entityId) query.set("entity_id", params.entityId);
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.order) query.set("order", params.order);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  const suffix = query.toString();
  const response = await fetch(
    `${serverBase()}/v1/cases/${caseId}/timeline${suffix ? `?${suffix}` : ""}`,
    { headers: authHeaders() },
  );
  if (response.status === 401) {
    throw new Error("Session expired. Sign in again.");
  }
  if (!response.ok) {
    throw new Error(`Timeline request failed (status ${response.status}).`);
  }
  return (await response.json()) as CaseTimeline;
}

function csvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function timelineToCsv(
  caseId: string,
  events: { event_type: string; ts: string; clock: string; description: string; actor: string | null }[],
): void {
  const lines = ["case_id,event_type,ts,clock,description,actor"];
  for (const event of events) {
    lines.push(
      [
        caseId,
        csvCell(event.event_type),
        event.ts,
        event.clock,
        csvCell(event.description),
        event.actor ?? "",
      ].join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `timeline-${caseId}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
