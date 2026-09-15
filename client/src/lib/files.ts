// File record reads for Ingestion detail + verification (FR-7.2,
// API_CONTRACTS.md §2.2): GET /files/{id} and GET /files/{id}/verify.
// Upload uses XHR so the per-file progress bar gets real bytes-sent
// events; ingest stage progress after that arrives from file status and
// ingest_jobs history (the ingest.progress socket in §2.9 is pending
// server-side, so nothing here pretends to listen on it).

import { getSession } from "./session";
import type {
  FileDetailResponse as FileDetail,
  IngestJob,
  VerifyFileResponse as FileVerify,
} from "../types/api";

// Generated types re-exported so existing `lib/files` importers keep
// working; the wire shapes live in types/generated/ (D30).
export type {
  FileDetailResponse as FileDetail,
  FileRecord,
  IngestJob,
  VerifyFileResponse as FileVerify,
  VerifyStatus as VerifyState,
} from "../types/api";

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
    throw new Error("Not permitted to view this case's files.");
  }
  if (response.status === 404) {
    throw new Error("File not found.");
  }
  if (!response.ok) {
    throw new Error(`File request failed (status ${response.status}).`);
  }
  return response;
}

export async function fetchFile(fileId: string): Promise<FileDetail> {
  const response = await fetch(`${serverBase()}/v1/files/${fileId}`, {
    headers: authHeaders(),
  });
  return (await check(response)).json() as Promise<FileDetail>;
}

export async function verifyFile(fileId: string): Promise<FileVerify> {
  const response = await fetch(`${serverBase()}/v1/files/${fileId}/verify`, {
    headers: authHeaders(),
  });
  return (await check(response)).json() as Promise<FileVerify>;
}

export interface UploadHandle {
  done: Promise<FileDetail>;
  abort: () => void;
}

/**
 * Multipart upload with real bytes-sent progress. The server responds as
 * soon as the file is hashed and stored (API_CONTRACTS.md §2.2); stage
 * progress after that comes from GET /files/{id} jobs, not this promise.
 */
export function uploadFile(
  caseId: string,
  file: File,
  fields: { documentType: string; provenance: string },
  onProgress: (percent: number) => void,
): UploadHandle {
  const session = getSession();
  if (!session) {
    throw new Error("not signed in");
  }
  const xhr = new XMLHttpRequest();
  const done = new Promise<FileDetail>((resolve, reject) => {
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as FileDetail);
        } catch {
          reject(new Error("Upload answered with an unreadable body."));
        }
      } else {
        reject(new Error(`Upload failed (status ${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed: network error.")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted.")));
    const body = new FormData();
    body.append("file", file, file.name);
    body.append("document_type", fields.documentType);
    body.append("provenance", fields.provenance);
    xhr.open("POST", `${serverBase()}/v1/cases/${caseId}/files`);
    xhr.setRequestHeader("Authorization", `Bearer ${session.token}`);
    xhr.send(body);
  });
  return { done, abort: () => xhr.abort() };
}

// ARCHITECTURE.md §4.3 ingest stages in pipeline order. The file status
// and job history map onto these; unknown statuses stay "pending" rather
// than guessing a position.
export const INGEST_STAGES = [
  "Hashing",
  "Storing",
  "Recognising",
  "Reviewing",
  "Extracting",
  "Committing",
] as const;

export type StageState = "pending" | "active" | "done" | "failed";

/** Map a file status + job history onto the six §4.3 stages. */
export function stageStates(status: string, jobs: IngestJob[]): {
  states: StageState[];
  failedReason: string | null;
} {
  const states: StageState[] = INGEST_STAGES.map(() => "pending");
  let failedReason: string | null = null;
  const failed = jobs.find((job) => job.status === "failed");
  if (failed) {
    failedReason = failed.reason ?? `Stage ${failed.stage} failed.`;
  }
  const doneCount = jobs.filter((job) => job.status === "done").length;
  for (let i = 0; i < Math.min(doneCount, states.length); i += 1) {
    states[i] = "done";
  }
  if (status === "failed" || failed) {
    const at = Math.min(doneCount, states.length - 1);
    states[at] = "failed";
    return { states, failedReason: failedReason ?? "Ingest failed." };
  }
  if (status === "completed") {
    return { states: states.map((): StageState => "done"), failedReason: null };
  }
  const active = Math.min(doneCount, states.length - 1);
  if (status !== "queued") {
    states[active] = "active";
  }
  return { states, failedReason: null };
}
