// Review queue reads for the Document Review screen (screen 07, FR-2.7,
// API_CONTRACTS.md §2.3): GET /cases/{id}/review and POST /review/{id}.
// Every field below the confidence threshold and every non-gated script
// routes here before any entity is created; nothing is created until the
// decide call returns.

import { getSession } from "./session";
import type { PreviewExtractionRequest, PreviewSpan } from "../types/api";
import type { DecideReviewResponse, ReviewItem, ReviewStatus } from "../types/api";

// Generated types re-exported so existing `lib/review` importers keep
// working; the wire shapes live in types/generated/ (D30).
export type { DecideReviewResponse, ReviewItem, ReviewStatus } from "../types/api";

function serverBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return (env?.VITE_SERVER_URL ?? "https://localhost:8443").replace(/\/$/, "");
}

function authHeaders(): Record<string, string> {
  const session = getSession();
  if (!session) {
    throw new Error("not signed in");
  }
  return { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" };
}

async function check(response: Response): Promise<Response> {
  if (response.status === 401) {
    throw new Error("Session expired. Sign in again.");
  }
  if (response.status === 403) {
    throw new Error("Not permitted to review this case.");
  }
  if (response.status === 404) {
    throw new Error("Review item not found.");
  }
  if (response.status === 409) {
    throw new Error("Already decided.");
  }
  if (!response.ok) {
    throw new Error(`Review request failed (status ${response.status}).`);
  }
  return response;
}

export async function fetchReviewQueue(caseId: string, status?: ReviewStatus): Promise<ReviewItem[]> {
  const query = status ? `?status=${status}` : "";
  const response = await fetch(`${serverBase()}/v1/cases/${caseId}/review${query}`, {
    headers: { Authorization: authHeaders().Authorization },
  });
  const rows = (await check(response)).json() as Promise<ReviewItem[]>;
  // Worst cases reviewed first: confidence ascending, nulls first.
  return (await rows).sort((a, b) => (a.confidence ?? -1) - (b.confidence ?? -1));
}

export async function decideReview(
  id: number,
  decision: { status: "corrected" | "accepted" | "rejected"; corrected_text?: string },
): Promise<DecideReviewResponse> {
  const response = await fetch(`${serverBase()}/v1/review/${id}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(decision),
  });
  return (await check(response)).json() as Promise<DecideReviewResponse>;
}

// Span preview (D29, API_CONTRACTS.md §2.3): resolves caller-supplied
// surfaces against the given text. No model call, no persistence --
// the server returns character spans (or found: false) plus one audit
// row. Request/response shapes are generated (PreviewExtractionRequest
// / PreviewSpan), never hand-written.
export async function previewExtraction(
  caseId: string,
  request: PreviewExtractionRequest,
): Promise<PreviewSpan[]> {
  const response = await fetch(`${serverBase()}/v1/cases/${caseId}/preview-extraction`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(request),
  });
  return (await check(response)).json() as Promise<PreviewSpan[]>;
}
