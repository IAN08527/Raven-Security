import { afterEach, describe, expect, it, vi } from "vitest";
import { getSession, login, logout, resetSessionForTests } from "./session";

const TOKEN = "header.payload.signature";

function gotrueOk(role = "io"): Response {
  return new Response(
    JSON.stringify({
      access_token: TOKEN,
      user: { id: "11111111-1111-1111-1111-111111111111", email: "io@example.test", app_metadata: { app_role: role } },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("in-memory GoTrue session (M5-T4)", () => {
  afterEach(() => {
    resetSessionForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stores the JWT in memory on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(gotrueOk()));
    const session = await login("io@example.test", "secret");
    expect(session.token).toBe(TOKEN);
    expect(session.role).toBe("io");
    expect(getSession()?.token).toBe(TOKEN);
  });

  it("never writes browser storage", async () => {
    const localSet = vi.spyOn(Storage.prototype, "setItem");
    const localGet = vi.spyOn(Storage.prototype, "getItem");
    const sessionSet = vi.spyOn(sessionStorage, "setItem");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(gotrueOk()));
    await login("io@example.test", "secret");
    logout();
    expect(localSet).not.toHaveBeenCalled();
    expect(localGet).not.toHaveBeenCalled();
    expect(sessionSet).not.toHaveBeenCalled();
  });

  it("reports invalid credentials specifically", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(login("io@example.test", "wrong")).rejects.toThrow("Invalid email or password.");
    expect(getSession()).toBeNull();
  });

  it("reports an unreachable auth service specifically", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("down")));
    await expect(login("io@example.test", "secret")).rejects.toThrow(
      "Cannot reach the authentication service."
    );
  });

  it("logout drops the session with nothing persisted to clear", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(gotrueOk()));
    await login("io@example.test", "secret");
    logout();
    expect(getSession()).toBeNull();
  });
});
