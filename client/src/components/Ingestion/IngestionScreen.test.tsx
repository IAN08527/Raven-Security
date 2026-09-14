import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { IngestionScreen } from "./IngestionScreen";
import { login, resetSessionForTests } from "../../lib/session";

beforeEach(() => {
  resetSessionForTests();
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
      return Promise.resolve(new Response("{}", { status: 404 }));
    }),
  );
});

describe("ingestion guards and warnings", () => {
  it("synthetic provenance shows the metrics warning", async () => {
    await login("officer@example.test", "password");
    render(<IngestionScreen onOpenReview={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Provenance"), { target: { value: "synthetic" } });
    expect(screen.getByText("Synthetic rows are excluded from all metrics.")).toBeTruthy();
  });

  it("oversize files are rejected with a reason, never uploaded", async () => {
    await login("officer@example.test", "password");
    render(<IngestionScreen onOpenReview={vi.fn()} />);
    const dz = screen.getByLabelText("Drop files here or browse");
    const big = new File([new Uint8Array([1])], "huge.pdf");
    Object.defineProperty(big, "size", { value: 300 * 1024 * 1024 });
    fireEvent.drop(dz, { dataTransfer: { files: [big] } });
    expect(await screen.findByText(/over the 200MB/)).toBeTruthy();
  });

  it("unsupported types are rejected with the accepted list", async () => {
    await login("officer@example.test", "password");
    render(<IngestionScreen onOpenReview={vi.fn()} />);
    const dz = screen.getByLabelText("Drop files here or browse");
    fireEvent.drop(dz, { dataTransfer: { files: [new File(["x"], "evil.exe")] } });
    expect(await screen.findByText(/unsupported type/)).toBeTruthy();
  });
});
