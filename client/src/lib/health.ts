// Health, node and camera reads for the Home dashboard (screen 02).
// Real endpoints only (API_CONTRACTS.md §2.6, §2.8): GET /health needs no
// auth; /nodes and /cameras ride the session JWT. Anything without a
// listing API (cases, entities, files, candidates) is left to honest
// empty states in the dashboard — never mock numbers.

import { getSession } from "./session";
import type { Camera, EngineNode, HealthReport } from "../types/api";

// Generated types re-exported so existing `lib/health` importers keep
// working; the wire shapes live in types/generated/ (D30).
export type { Camera, DependencyStatus, EngineNode, HealthReport } from "../types/api";

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

async function get<T>(path: string, authed: boolean): Promise<T> {
  const response = await fetch(`${serverBase()}/v1${path}`, {
    headers: authed ? authHeaders() : {},
  });
  if (!response.ok) {
    throw new Error(`request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchHealth(): Promise<HealthReport> {
  return get<HealthReport>("/health", false);
}

export function fetchNodes(): Promise<EngineNode[]> {
  return get<EngineNode[]>("/nodes", true);
}

export function fetchCameras(): Promise<Camera[]> {
  return get<Camera[]>("/cameras", true);
}

export async function registerCamera(input: {
  code: string;
  label: string;
  declared_start_ts: string;
  fps: number;
}): Promise<Camera> {
  const session = getSession();
  if (!session) {
    throw new Error("not signed in");
  }
  const response = await fetch(`${serverBase()}/v1/cameras`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`camera registration failed: ${response.status}`);
  }
  return (await response.json()) as Camera;
}

/** Camera codes claimed by nodes whose status is not degraded. */
export function onlineCameraCodes(nodes: EngineNode[]): Set<string> {
  const online = new Set<string>();
  for (const node of nodes) {
    if (node.status !== "degraded") {
      for (const code of node.cameras) {
        online.add(code);
      }
    }
  }
  return online;
}
