import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CameraSettings } from "./CameraSettings";
import { login, resetSessionForTests } from "../../lib/session";

function stubCameras(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
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
      if (target.endsWith("/v1/cameras") && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "cam-9",
              code: "cam_09",
              label: "Back gate",
              declared_start_ts: "2025-11-02T14:00:00Z",
              fps: 10,
            }),
            { status: 201 },
          ),
        );
      }
      if (target.endsWith("/v1/cameras")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: "cam-1",
                code: "cam_01",
                label: "Gate",
                declared_start_ts: "2025-11-02T14:00:00Z",
                fps: 10,
              },
            ]),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }),
  );
}

describe("camera settings", () => {
  beforeEach(() => {
    resetSessionForTests();
    vi.unstubAllGlobals();
  });

  it("lists cameras and registers a new one with declared start", async () => {
    stubCameras();
    await login("admin@example.test", "password");
    render(<CameraSettings />);
    expect(await screen.findByText("Gate")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Camera code"), { target: { value: "cam_09" } });
    fireEvent.change(screen.getByLabelText("Camera label"), { target: { value: "Back gate" } });
    fireEvent.change(screen.getByLabelText("Declared start"), {
      target: { value: "2025-11-02T14:00" },
    });
    fireEvent.click(screen.getByText("Register"));
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    const post = calls.find(([url, init]) => url.endsWith("/v1/cameras") && init?.method === "POST");
    expect(post).toBeTruthy();
    expect(String(post?.[1]?.body)).toContain("2025-11-02T14:00:00");
  });

  it("names the missing management backends instead of mocking them", async () => {
    stubCameras();
    await login("admin@example.test", "password");
    render(<CameraSettings />);
    await screen.findByText("Gate");
    expect(screen.getByText(/POST \/camera-edges/)).toBeTruthy();
    expect(screen.getByText(/Form templates/)).toBeTruthy();
    expect(screen.getByText(/Weight parameters/)).toBeTruthy();
  });
});
