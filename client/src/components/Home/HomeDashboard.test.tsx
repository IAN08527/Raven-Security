import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { HomeDashboard } from "./HomeDashboard";
import { resetSessionForTests, login } from "../../lib/session";

function mockFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/auth/v1/token")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "test-jwt",
              user: { id: "officer-1", email: "officer@example.test", app_metadata: { app_role: "io" } },
            }),
            { status: 200 },
          ),
        );
      }
      if (url.endsWith("/v1/health")) {
        return Promise.resolve(
          new Response(JSON.stringify({ dependencies: [{ name: "postgres", healthy: true, detail: "ok" }] }), { status: 200 }),
        );
      }
      if (url.endsWith("/v1/nodes")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { id: "n1", name: "node-1", status: "ready", budget_dps: 10, gpu_name: "gpu", cameras: ["cam_01"], last_seen: "2025-11-02T10:00:00Z" },
            ]),
            { status: 200 },
          ),
        );
      }
      if (url.endsWith("/v1/cameras")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([{ id: "c1", code: "cam_01", label: "Gate", declared_start_ts: "2025-11-02T10:00:00Z", fps: 10 }]),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response("[]", { status: 200 }));
    }),
  );
}

beforeEach(() => {
  resetSessionForTests();
  mockFetch();
});

async function signIn(): Promise<void> {
  await login("officer@example.test", "password");
}

describe("home dashboard wires to real data, never mock", () => {
  it("shows the live camera count and marks unlisted tiles honestly", async () => {
    await signIn();
    render(<HomeDashboard onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Cameras Online")).toBeTruthy());
    expect(screen.getByText("1")).toBeTruthy();
    // Tiles without a listing API show an em-dash, never an invented number.
    expect(screen.getAllByText("No listing API yet.").length).toBeGreaterThan(0);
  });

  it("camera status derives online from engine nodes", async () => {
    await signIn();
    render(<HomeDashboard onNavigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Gate")).toBeTruthy());
    expect(screen.getByText("Online")).toBeTruthy();
  });
});
