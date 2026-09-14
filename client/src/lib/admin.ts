// User administration calls (API_CONTRACTS.md §2.11, D21).
// Admin role only, enforced server-side. Self-contained session
// handling like lib/audit.ts.

import { getSession } from "./session";
import type { AdminUser } from "../types/api";

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
    throw new Error("Administration requires the administrator role.");
  }
  if (!response.ok) {
    let code = "INTERNAL";
    try {
      const body = (await response.json()) as { error?: { code?: string } };
      if (body.error?.code) code = body.error.code;
    } catch {
      // Non-JSON error body: keep the default code.
    }
    throw new Error(`Admin request failed (${code}).`);
  }
  return response;
}

export async function fetchUsers(): Promise<AdminUser[]> {
  const response = await fetch(`${serverBase()}/v1/admin/users`, { headers: authHeaders() });
  return (await check(response)).json() as Promise<AdminUser[]>;
}

export async function createUser(input: {
  email: string;
  badge_no: string;
  full_name: string;
  role: string;
}): Promise<AdminUser> {
  const response = await fetch(`${serverBase()}/v1/admin/users`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await check(response)).json() as Promise<AdminUser>;
}

export async function setUserActive(id: string, active: boolean): Promise<AdminUser> {
  const response = await fetch(`${serverBase()}/v1/admin/users/${id}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });
  return (await check(response)).json() as Promise<AdminUser>;
}
