import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AuditPane } from "./AuditPane";
import { login, resetSessionForTests } from "../../lib/session";

const ROWS = [
  {
    id: "row-1",
    case_id: "case-1",
    user_id: "officer-1",
    user_role: "io",
    action: "candidate.confirm",
    object_type: "reid_candidate",
    object_id: "obj-1",
    payload_hash: "stored-hash-1",
    ledger_tx_id: "stub-tx-1",
    ledger_status: "anchored",
    created_at: "2025-11-02T14:00:00Z",
  },
  {
    id: "row-2",
    case_id: "case-1",
    user_id: "officer-2",
    user_role: "io",
    action: "review.accept",
    object_type: "review_item",
    object_id: "obj-2",
    payload_hash: "stored-hash-2",
    ledger_tx_id: "stub-tx-2",
    ledger_status: "anchored",
    created_at: "2025-11-02T15:00:00Z",
  },
];

function mockFetch(): ReturnType<typeof vi.fn> {
  const calls: string[] = [];
  const stub = vi.fn().mockImplementation((url: string) => {
    calls.push(url);
    if (url.includes("/auth/v1/token")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "test-jwt",
            user: { id: "auditor-1", email: "auditor@example.test", app_metadata: { app_role: "auditor" } },
          }),
          { status: 200 }
        )
      );
    }
    if (url.includes("/verify")) {
      const tampered = url.includes("row-2");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            row_id: tampered ? "row-2" : "row-1",
            object_id: tampered ? "obj-2" : "obj-1",
            stored_hash: tampered ? "stored-hash-2" : "stored-hash-1",
            ledger_hash: tampered ? "different-hash" : "stored-hash-1",
            tampered,
            endorsements: tampered
              ? [{ org: "mock", mode: "mock" }]
              : [{ org: "district-cid" }, { org: "cyber-cell" }],
            ledger_tx_id: "stub-tx-1",
          }),
          { status: 200 }
        )
      );
    }
    if (url.includes("/export")) {
      return Promise.resolve(new Response("timestamp,user_id\n", { status: 200 }));
    }
    const action = new URL(url, "https://localhost:8443").searchParams.get("action");
    const rows = action ? ROWS.filter((row) => row.action === action) : ROWS;
    return Promise.resolve(new Response(JSON.stringify(rows), { status: 200 }));
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

describe("auditor view (M5-T3, FR-7.5)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockFetch();
    Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:csv"), configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
  });

  afterEach(() => {
    resetSessionForTests();
  });

  async function renderSignedIn(): Promise<void> {
    await login("auditor@example.test", "secret");
    render(<AuditPane caseId="case-1" />);
  }

  it("lists rows with timestamp, user, action, object, tx and status", async () => {
    await renderSignedIn();
    expect(await screen.findByText("candidate.confirm")).toBeTruthy();
    expect(screen.getByText("review.accept")).toBeTruthy();
    expect(screen.getByText("stub-tx-1")).toBeTruthy();
  });

  it("verified row shows org chips; tampered row shows TAMPERED plus both hashes", async () => {
    await renderSignedIn();
    // Wait for the data rows before querying them: findAllByRole would
    // otherwise resolve on the header row alone.
    await screen.findByText("candidate.confirm");
    const rows = screen.getAllByRole("row");
    // Expand the verified row (first data row).
    fireEvent.click(rows[1]);
    fireEvent.click(await screen.findByText("Verify"));
    expect(await screen.findByText("Verified")).toBeTruthy();
    expect(screen.getByText("district-cid")).toBeTruthy();

    // Expand the tampered row and verify: red border AND label AND hashes.
    const table = screen.getByRole("table");
    const tamperedRow = within(table).getByText("review.accept").closest("tr");
    if (!tamperedRow) throw new Error("tampered row missing");
    fireEvent.click(tamperedRow);
    const verifyButtons = screen.getAllByText("Verify");
    fireEvent.click(verifyButtons[verifyButtons.length - 1]);
    const label = await screen.findByText("TAMPERED");
    expect(label).toBeTruthy();
    expect(label.className).toContain("border-red-500");
    expect(screen.getByText("stored-hash-2")).toBeTruthy();
    expect(screen.getByText("different-hash")).toBeTruthy();
    // Mock endorsement renders the amber badge, not org chips.
    expect(screen.getByText("MOCK LEDGER")).toBeTruthy();
  });

  it("action filter re-queries and export hits the export endpoint", async () => {
    const stub = mockFetch();
    await renderSignedIn();
    await screen.findByText("candidate.confirm");
    fireEvent.change(screen.getByLabelText("Filter by action"), {
      target: { value: "review.accept" },
    });
    await waitFor(() => {
      expect(stub.mock.calls.some((call) => String(call[0]).includes("action=review.accept"))).toBe(true);
    });
    fireEvent.click(screen.getByText("Export CSV"));
    await waitFor(() => {
      expect(stub.mock.calls.some((call) => String(call[0]).includes("/export"))).toBe(true);
    });
  });
});
