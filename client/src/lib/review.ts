// Review queue reads for the Document Review screen (screen 07, FR-2.7,
// API_CONTRACTS.md §2.3): GET /cases/{id}/review and POST /review/{id}.
// Every field below the confidence threshold and every non-gated script
// routes here before any entity is created; nothing is created until the
// decide call returns.

import { getSession } from "./session";

export type ReviewStatus = "pending" | "corrected" | "accepted" | "rejected";

export interface ReviewItem {
  id: number;
  case_id: string;
  source_file_id: string;
  page_no: number | null;
  line_no: number | null;
  field_name: string | null;
  script: string;
  crop_path: string;
  recognised_text: string | null;
  confidence: number | null;
  corrected_text: string | null;
  status: ReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  ledger_tx_id: string | null;
}

export interface DecideReviewResponse {
  id: number;
  status: ReviewStatus;
  ledger_tx_id: string | null;
  ledger_status: string;
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
