import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { EntityProfile } from "./EntityProfile";
import { login, resetSessionForTests } from "../../lib/session";

const RECORD = {
  id: "e1",
  case_id: "case-1",
  type: "PERSON",
  canonical_name: "Ravi Kumar",
  aliases: ["Chhotu"],
  identifiers: ["9822012345"],
  relationships: [],
  associated_cases: ["case-1"],
  case_count: 1,
  provenance: "collected",
  sync_state: "synced",
  notes: [],
};

const EGO = {
  nodes: [
    { id: "e1", type: "PERSON", label: "Ravi Kumar" },
    { id: "e2", type: "PERSON", label: "Suresh Yadav" },
  ],
  edges: [{ id: "g1", src: "e1", dst: "e2", type: "CALLED", weight: 8 }],
};

const EVIDENCE = [
  {
    id: 1,
    kind: "fir_text",
    snippet: "Ravi called Suresh",
    char_start: 0,
    char_end: 18,
    page_no: 1,
    source_file_id: "f1",
    provenance: "collected",
    tamper_state: "tampered",
    occurred_at: "2025-11-02T10:00:00.000Z",
    ledger_hash: "ledger-abc123",
    computed_hash: "computed-def456",
  },
];

function stubFetch(role: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/auth/v1/token")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { email?: string };
        const appRole = body.email?.includes("analyst") ? "analyst" : role;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "test-jwt",
              user: { id: "officer-1", email: body.email ?? "", app_metadata: { app_role: appRole } },
            }),
            { status: 200 },
          ),
        );
      }
      if (target.endsWith("/entities/e1/notes") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { text: string };
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "n1",
              entity_id: "e1",
              text: body.text,
              created_by: "officer-1",
              created_at: "2026-09-14T00:00:00.000Z",
            }),
            { status: 201 },
          ),
        );
      }
      if (target.endsWith("/entities/merge")) {
        return Promise.resolve(
          new Response(JSON.stringify({ merge_id: 7, status: "proposed" }), { status: 201 }),
        );
      }
      if (target.includes("/cases/case-1/entities")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              results: [
                {
                  id: "e2",
                  type: "PERSON",
                  canonical_name: "Suresh Yadav",
                  identifiers: [],
                  case_count: 1,
                  provenance: "collected",
                  sync_state: "synced",
                },
              ],
              next_cursor: null,
            }),
            { status: 200 },
          ),
        );
      }
      if (target.endsWith("/entities/e1")) {
        return Promise.resolve(new Response(JSON.stringify(RECORD), { status: 200 }));
      }
      if (target.includes("/graph/ego")) {
        return Promise.resolve(new Response(JSON.stringify(EGO), { status: 200 }));
      }
      if (target.includes("/edges/g1/evidence")) {
        return Promise.resolve(new Response(JSON.stringify(EVIDENCE), { status: 200 }));
      }
      if (target.includes("/files/f1")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              file: { name: "seized-letter.pdf" },
              jobs: [],
              ledger_tx_id: null,
            }),
            { status: 200 },
          ),
        );
      }
      if (target.includes("/cases/case-1/audit")) {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }),
  );
}

function renderProfile(): void {
  render(
    <EntityProfile entityId="e1" caseId="case-1" onBack={vi.fn()} onOpenEntity={vi.fn()} />,
  );
}

describe("entity profile", () => {
  beforeEach(() => {
    resetSessionForTests();
    vi.unstubAllGlobals();
  });

  it("renders detail with no risk score section", async () => {
    stubFetch("io");
    await login("officer@example.test", "password");
    renderProfile();
    expect(await screen.findByRole("heading", { name: "Ravi Kumar" })).toBeTruthy();
    expect(screen.getByText("PERSON")).toBeTruthy();
    expect(screen.getByText("collected")).toBeTruthy();
    expect(screen.queryByText("Risk score")).toBeNull();
  });

  it("relations tab lists neighbours with weight and evidence count", async () => {
    stubFetch("io");
    await login("officer@example.test", "password");
    renderProfile();
    await screen.findByRole("heading", { name: "Ravi Kumar" });
    fireEvent.click(screen.getByRole("tab", { name: "Relations" }));
    const row = await screen.findByText("Suresh Yadav");
    const item = row.closest("li") as HTMLElement;
    expect(
      within(item).getByText((_, element) => element?.textContent === "CALLED · weight 8.00 · 1 evidence"),
    ).toBeTruthy();
  });

  it("evidence tab shows kind, tamper label and both hashes", async () => {
    stubFetch("io");
    await login("officer@example.test", "password");
    renderProfile();
    await screen.findByRole("heading", { name: "Ravi Kumar" });
    fireEvent.click(screen.getByRole("tab", { name: "Evidence" }));
    // "fir_text" renders twice: the kind-filter option and the row badge.
    expect(await screen.findAllByText("fir_text")).toHaveLength(2);
    expect(screen.getByText("TAMPERED")).toBeTruthy();
    expect(screen.getByText(/stored computed-def456/)).toBeTruthy();
    expect(screen.getByText(/anchored ledger-abc123/)).toBeTruthy();
    // The file name resolves one round-trip after the evidence rows.
    expect(await screen.findByText(/seized-letter\.pdf/)).toBeTruthy();
  });

  it("io saves a note through the annotation endpoint", async () => {
    stubFetch("io");
    await login("officer@example.test", "password");
    renderProfile();
    await screen.findByRole("heading", { name: "Ravi Kumar" });
    fireEvent.change(screen.getByLabelText("New note"), { target: { value: "Watchlisted." } });
    fireEvent.click(screen.getByText("Save note"));
    expect(await screen.findByText("Watchlisted.")).toBeTruthy();
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    expect(calls.some(([url, init]) => url.endsWith("/entities/e1/notes") && init?.method === "POST")).toBe(
      true,
    );
  });

  it("analyst sees no annotation or link actions", async () => {
    stubFetch("analyst");
    await login("analyst@example.test", "password");
    renderProfile();
    await screen.findByRole("heading", { name: "Ravi Kumar" });
    expect(screen.queryByText("Add Note")).toBeNull();
    expect(screen.queryByText("Create Link")).toBeNull();
    expect(screen.getByText("Annotation requires the investigating-officer role.")).toBeTruthy();
  });

  it("create link proposes a merge without applying it", async () => {
    stubFetch("io");
    await login("officer@example.test", "password");
    renderProfile();
    await screen.findByRole("heading", { name: "Ravi Kumar" });
    fireEvent.click(screen.getByText("Create Link"));
    fireEvent.change(screen.getByLabelText("Link target search"), { target: { value: "Suresh" } });
    fireEvent.click(screen.getByText("Search"));
    fireEvent.click(await screen.findByRole("radio"));
    fireEvent.change(screen.getByLabelText("Link reason"), {
      target: { value: "shared identifier plus normalised name" },
    });
    fireEvent.click(screen.getByText("Propose merge"));
    expect(await screen.findByText(/status proposed/)).toBeTruthy();
  });
});
