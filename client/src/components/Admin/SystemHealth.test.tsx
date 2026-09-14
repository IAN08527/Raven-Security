import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SystemHealth } from "./SystemHealth";
import { login, resetSessionForTests } from "../../lib/session";

function stubHealth(basemapOk: boolean): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      const target = String(url);
      if (target.includes("/auth/v1/token")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "test-jwt",
              user: { id: "admin-1", email: "admin@example.test", app_metadata: { app_role: "admin" } },
            }),
            { status: 200 },
          ),
        );
      }
      if (target.endsWith("/v1/health")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              dependencies: [
                { name: "postgres", healthy: true, detail: "ok" },
                { name: "ledger", healthy: false, detail: "gateway unreachable" },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      if (target.endsWith("/v1/nodes")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: "n1",
                name: "node-a",
                status: "ready",
                budget_dps: 42.5,
                gpu_name: "RTX 4050",
                cameras: ["cam_01"],
                last_seen: "2026-09-14T00:00:00Z",
              },
            ]),
            { status: 200 },
          ),
        );
      }
      if (target.includes("8802")) {
        return Promise.resolve(new Response("", { status: basemapOk ? 200 : 500 }));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }),
  );
}

describe("system health", () => {
  beforeEach(() => {
    resetSessionForTests();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders dependency, node and basemap cards with instant state", async () => {
    stubHealth(true);
    await login("admin@example.test", "password");
    render(<SystemHealth basemapUrl="http://localhost:8802/maharashtra.pmtiles" />);
    expect(await screen.findByText("postgres")).toBeTruthy();
    expect(screen.getByText("gateway unreachable")).toBeTruthy();
    expect(screen.getByText("node-a")).toBeTruthy();
    expect(screen.getByText(/budget 42\.5 det\/s/)).toBeTruthy();
    expect(screen.getByText("basemap")).toBeTruthy();
    // No transition classes on status changes: state flips are instant.
    expect(document.querySelector(".transition-all")).toBeNull();
  });

  it("a failing basemap probe reads degraded, not healthy", async () => {
    stubHealth(false);
    await login("admin@example.test", "password");
    render(<SystemHealth basemapUrl="http://localhost:8802/maharashtra.pmtiles" />);
    await screen.findByText("basemap");
    expect(screen.getByText(/answered 500/)).toBeTruthy();
  });
});
