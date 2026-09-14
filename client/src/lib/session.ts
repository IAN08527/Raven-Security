// In-memory GoTrue session (M5-T4, D21).
//
// The JWT lives in a module variable for the lifetime of the window and
// is never written to localStorage, sessionStorage, cookies or disk:
// a persisted token outlives the operator's presence at the workstation.
// There is no "remember me"; closing the window drops the session.
//
// GoTrue runs on loopback (same host as Supabase); this is not egress
// (CLAUDE.md rule 6). The base URL is configurable for deployed hosts
// but defaults to the local stack.

import { parseRole, type AppRole } from "./roles";

export interface Session {
  token: string;
  userId: string;
  email: string;
  role: AppRole;
}

export class LoginError extends Error {
  readonly kind: "credentials" | "unreachable" | "forbidden" | "unknown";
  constructor(kind: LoginError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

function gotrueBase(): string {
  // import.meta.env is typed by vite/client; the fallback keeps tests
  // and Tauri builds working without env configuration.
  let configured: string | undefined;
  if (typeof import.meta !== "undefined") {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env;
    configured = env?.VITE_GOTRUE_URL;
  }
  return (configured ?? "http://localhost:54321").replace(/\/$/, "");
}

let current: Session | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Subscribe to session changes (login/logout). Returns an unsubscribe. */
export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current session snapshot, or null when logged out. */
export function getSession(): Session | null {
  return current;
}

/**
 * Sign in with email + password against GoTrue
 * (POST /auth/v1/token?grant_type=password). On success the JWT is kept
 * in memory only. On failure a specific LoginError is thrown -- never a
 * generic "something went wrong".
 */
export async function login(email: string, password: string): Promise<Session> {
  let response: Response;
  try {
    response = await fetch(`${gotrueBase()}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: getAnonKey() },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new LoginError("unreachable", "Cannot reach the authentication service. Check that the local stack is running.");
  }
  if (response.status === 400 || response.status === 401) {
    throw new LoginError("credentials", "Invalid email or password.");
  }
  if (response.status === 403) {
    throw new LoginError("forbidden", "This account is not permitted to sign in.");
  }
  if (!response.ok) {
    throw new LoginError("unknown", `Sign-in failed (status ${response.status}).`);
  }
  const body = (await response.json()) as {
    access_token?: string;
    user?: {
      id?: string;
      email?: string;
      app_metadata?: { app_role?: unknown };
      user_metadata?: { app_role?: unknown };
    };
  };
  const token = body.access_token;
  const user = body.user;
  const role = parseRole(user?.app_metadata?.app_role ?? user?.user_metadata?.app_role);
  if (!token || !user?.id || !role) {
    throw new LoginError("unknown", "Sign-in succeeded but the account has no recognised role. Contact an administrator.");
  }
  current = { token, userId: user.id, email: user.email ?? email, role };
  notify();
  return current;
}

/** Sign out: drop the in-memory session. Nothing persists to clear. */
export function logout(): void {
  current = null;
  notify();
}

function getAnonKey(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return env?.VITE_GOTRUE_ANON_KEY ?? "";
}

/** Test seam: reset the module session without touching any storage. */
export function resetSessionForTests(): void {
  current = null;
  listeners.clear();
}
