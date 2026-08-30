import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  EgoGraph,
  EdgeEvidence,
  EntityDetails,
  GraphNode,
} from "../types/generated";
import { mockInvoke } from "../dev/mockGraph";

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const ENGINE_URL =
  (import.meta.env.VITE_ENGINE_URL as string | undefined) ??
  "http://127.0.0.1:8756";

type AnyRecord = Record<string, unknown>;

// Map a Tauri command name to a Raven engine HTTP route (dev mirror, §Backlog
// #4). The engine serves the SAME graph SQL so the UI runs in a plain browser
// without building the Rust shell.
const ENGINE_ROUTES: Record<
  string,
  { path: string; method: "GET" | "POST"; body?: (a: AnyRecord) => AnyRecord }
> = {
  get_macro_graph: {
    path: "/graph/macro",
    method: "POST",
    body: (a) => ({ case_id: a.case_id, min_weight: a.min_weight, limit: a.limit }),
  },
  get_ego_graph: {
    path: "/graph/ego",
    method: "POST",
    body: (a) => ({ entity_id: a.entity_id, hops: a.hops, min_weight: a.min_weight }),
  },
  get_edge_evidence: {
    path: "/graph/edge_evidence",
    method: "POST",
    body: (a) => ({ rel_id: a.rel_id }),
  },
  get_entity_details: {
    path: "/graph/entity",
    method: "POST",
    body: (a) => ({ entity_id: a.entity_id }),
  },
  list_entities: {
    path: "/graph/entities",
    method: "POST",
    body: (a) => ({ case_id: a.case_id }),
  },
};

async function engineInvoke<T>(cmd: string, args?: AnyRecord): Promise<T> {
  // health_check has no 1:1 engine route; adapt the engine /health shape.
  if (cmd === "health_check") {
    const res = await fetch(`${ENGINE_URL}/health`);
    if (!res.ok) throw new Error(`engine /health -> ${res.status}`);
    const h = (await res.json()) as { db?: string; status?: string };
    const up = h.db === "up" || h.status === "up";
    return {
      supabase: up ? "up" : "down",
      neo4j: "n/a",
      ollama: "n/a",
      fabric: "n/a",
      python: "up",
      vram_free_mb: 0,
    } as unknown as T;
  }
  const route = ENGINE_ROUTES[cmd];
  if (!route) {
    throw new Error(`no engine route for command "${cmd}"`);
  }
  const res = await fetch(`${ENGINE_URL}${route.path}`, {
    method: route.method,
    headers: { "Content-Type": "application/json" },
    body: route.method === "POST" ? JSON.stringify(route.body ? route.body(args ?? {}) : {}) : undefined,
  });
  if (!res.ok) {
    throw new Error(`engine ${route.path} -> ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Unified command bridge.
 *
 * 1. Inside the Tauri shell -> real Rust command (Bolt + Postgres).
 * 2. In a browser dev server -> the Python engine's graph endpoints (live
 *    cloud data) when reachable.
 * 3. Otherwise -> an embedded deterministic mock so `npm run dev` always
 *    renders a populated network for UI rehearsal.
 */
export async function invokeRaven<T>(cmd: string, args?: AnyRecord): Promise<T> {
  if (isTauri()) {
    return tauriInvoke<T>(cmd, args);
  }
  try {
    return await engineInvoke<T>(cmd, args);
  } catch {
    return mockInvoke<T>(cmd, args);
  }
}

export const usingMock = (): boolean => !isTauri();
