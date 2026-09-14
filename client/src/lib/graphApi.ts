import type {
  EdgeEvidenceItem,
  EntityDetail,
  GraphEntityType,
  GraphPayload,
} from "../types/api";

export interface GraphError extends Error {
  status: number;
  code: string;
}

async function request<T>(url: string, sessionToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  if (!response.ok) {
    let code = "INTERNAL";
    try {
      const body = (await response.json()) as { error?: { code?: string } };
      if (body.error?.code) code = body.error.code;
    } catch {
      // Non-JSON error body: keep the default code.
    }
    const error = new Error(`graph request failed: ${response.status}`) as GraphError;
    error.status = response.status;
    error.code = code;
    throw error;
  }
  return (await response.json()) as T;
}

/**
 * M4-T3. Graph fetchers (API_CONTRACTS.md §2.4). Each call is one
 * independent REST round-trip: the evidence endpoint in particular must
 * never trigger a graph re-query or layout reflow, so it shares no
 * state with the ego/macro fetchers below.
 */
export function fetchEgoGraph(
  serverBase: string,
  sessionToken: string,
  caseId: string,
  entityId: string,
  opts: { hops?: 1 | 2; minWeight?: number; types?: GraphEntityType[] } = {},
): Promise<GraphPayload> {
  const params = new URLSearchParams({ entity_id: entityId });
  if (opts.hops !== undefined) params.set("hops", String(opts.hops));
  if (opts.minWeight !== undefined) params.set("min_weight", String(opts.minWeight));
  params.set("types", (opts.types ?? ["PERSON"]).join(","));
  return request<GraphPayload>(`${serverBase}/cases/${caseId}/graph/ego?${params}`, sessionToken);
}

export function fetchMacroGraph(
  serverBase: string,
  sessionToken: string,
  caseId: string,
  opts: { minWeight?: number; types?: GraphEntityType[] } = {},
): Promise<GraphPayload> {
  const params = new URLSearchParams();
  if (opts.minWeight !== undefined) params.set("min_weight", String(opts.minWeight));
  params.set("types", (opts.types ?? ["PERSON"]).join(","));
  const query = params.toString();
  return request<GraphPayload>(`${serverBase}/cases/${caseId}/graph/macro?${query}`, sessionToken);
}

export function fetchEdgeEvidence(
  serverBase: string,
  sessionToken: string,
  edgeId: string,
): Promise<EdgeEvidenceItem[]> {
  return request<EdgeEvidenceItem[]>(`${serverBase}/edges/${edgeId}/evidence`, sessionToken);
}

export function fetchEntity(
  serverBase: string,
  sessionToken: string,
  entityId: string,
): Promise<EntityDetail> {
  return request<EntityDetail>(`${serverBase}/entities/${entityId}`, sessionToken);
}
