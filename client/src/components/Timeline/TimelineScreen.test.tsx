import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TimelineScreen } from "./TimelineScreen";
import { login, resetSessionForTests } from "../../lib/session";

const PAGE = {
  results: [
    {
      event_type: "file_ingested",
      ts: "2026-09-14T10:00:00Z",
      clock: "system",
      description: "Document ingested: seized-letter.pdf",
      actor: null,
      entity_refs: [],
      detail: {},
    },
    {
      event_type: "evidence_committed",
      ts: "2025-11-02T10:00:00Z",
      clock: "case",
      description: "fir_text evidence committed",
      actor: null,
      entity_refs: ["e1"],
      detail: { tamper_state: "tampered", ledger_hash: "ledger-abc", computed_hash: "computed-def" },
    },
  ],
  next_cursor: null,
};

function stubTimeline(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      const target = String(url);
      if (target.includes("/auth/v1/token")) {
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
      if (target.includes("/cases/case-1/timeline")) {
        return Promise.resolve(new Response(JSON.stringify(PAGE), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }),
  );
}

describe("case timeline", () => {
  beforeEach(() => {
    resetSessionForTests();
    vi.unstubAllGlobals();
  });

  it("labels clocks and flags tampered evidence with both hashes", async () => {
    stubTimeline();
    await login("officer@example.test", "password");
    render(<TimelineScreen caseId="case-1" onOpenEntity={vi.fn()} />);
    expect(await screen.findByText("Document ingested: seized-letter.pdf")).toBeTruthy();
    expect(screen.getByText("SYSTEM TIME")).toBeTruthy();
    expect(screen.getByText("CASE TIME")).toBeTruthy();
    expect(screen.getByText("TAMPERED")).toBeTruthy();
    expect(screen.getByText(/stored computed-def/)).toBeTruthy();
    expect(screen.getByText(/anchored ledger-abc/)).toBeTruthy();
  });

  it("entity references open the entity profile", async () => {
    stubTimeline();
    await login("officer@example.test", "password");
    const onOpenEntity = vi.fn();
    render(<TimelineScreen caseId="case-1" onOpenEntity={onOpenEntity} />);
    await screen.findByText("fir_text evidence committed");
    fireEvent.click(screen.getByTitle("e1"));
    expect(onOpenEntity).toHaveBeenCalledWith("e1");
  });

  it("export downloads the filtered events as CSV", async () => {
    stubTimeline();
    await login("officer@example.test", "password");
    const createObjectURL = vi.fn(() => "blob:timeline");
    const revokeObjectURL = vi.fn();
    window.URL.createObjectURL = createObjectURL;
    window.URL.revokeObjectURL = revokeObjectURL;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<TimelineScreen caseId="case-1" onOpenEntity={vi.fn()} />);
    await screen.findByText("Document ingested: seized-letter.pdf");
    fireEvent.click(screen.getByText("Export CSV"));
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
    click.mockRestore();
  });
});
