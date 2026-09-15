import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ReviewScreen } from "./ReviewScreen";
import { login, resetSessionForTests } from "../../lib/session";

const ITEMS = [
  {
    id: 1,
    case_id: "case-1",
    source_file_id: "file-1",
    page_no: 2,
    line_no: 4,
    field_name: "accused_name",
    script: "Latn",
    crop_path: "/crops/1.png",
    recognised_text: "Ravi Kumar",
    confidence: 0.42,
    corrected_text: null,
    status: "pending",
    reviewed_by: null,
    reviewed_at: null,
    ledger_tx_id: null,
  },
  {
    id: 2,
    case_id: "case-1",
    source_file_id: "file-1",
    page_no: 2,
    line_no: 5,
    field_name: null,
    script: "Deva",
    crop_path: "/crops/2.png",
    recognised_text: "address line",
    confidence: 0.91,
    corrected_text: null,
    status: "pending",
    reviewed_by: null,
    reviewed_at: null,
    ledger_tx_id: null,
  },
];

let posted: { url: string; body: string }[] = [];

beforeEach(() => {
  resetSessionForTests();
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
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
      if (url.includes("/cases/case-1/review")) {
        return Promise.resolve(new Response(JSON.stringify(ITEMS), { status: 200 }));
      }
      if (url.includes("/cases/case-1/preview-extraction")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          text: string;
          surfaces: { type: string; value: string }[];
        };
        const spans = body.surfaces.map((surface) => {
          const at = body.text.indexOf(surface.value);
          return at < 0
            ? { ...surface, char_start: null, char_end: null, found: false }
            : { ...surface, char_start: at, char_end: at + surface.value.length, found: true };
        });
        return Promise.resolve(new Response(JSON.stringify(spans), { status: 200 }));
      }
      if (url.includes("/review/")) {
        posted.push({ url, body: String(init?.body ?? "") });
        const id = Number(url.split("/review/")[1]);
        return Promise.resolve(
          new Response(JSON.stringify({ id, status: "accepted", ledger_tx_id: "tx-1", ledger_status: "anchored" }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }),
  );
});

describe("document review (FR-2.7)", () => {
  it("sorts worst confidence first and shows the crop with editable text", async () => {
    await login("officer@example.test", "password");
    render(<ReviewScreen caseId="case-1" />);
    const queue = await screen.findByLabelText("Review queue");
    const buttons = within(queue as HTMLElement).getAllByRole("button");
    expect(buttons[0].textContent).toContain("accused_name");
    fireEvent.click(buttons[0]);
    expect(screen.getByLabelText("Recognised text")).toHaveProperty("value", "Ravi Kumar");
    expect(screen.getByText("Field: accused_name")).toBeTruthy();
  });

  it("keyboard A accepts and R rejects, Tab moves next", async () => {
    await login("officer@example.test", "password");
    render(<ReviewScreen caseId="case-1" />);
    await screen.findByLabelText("Review queue");
    fireEvent.click((await screen.findAllByRole("button")).find((b) => b.textContent?.includes("accused_name"))!);
    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0].body).toContain("accepted");
    fireEvent.keyDown(window, { key: "Tab" });
    fireEvent.keyDown(window, { key: "r" });
    await waitFor(() => expect(posted.length).toBe(2));
    expect(posted[1].body).toContain("rejected");
  });

  it("locate resolves a surface to its span via preview-extraction", async () => {
    await login("officer@example.test", "password");
    render(<ReviewScreen caseId="case-1" />);
    await screen.findByLabelText("Review queue");
    fireEvent.click((await screen.findAllByRole("button")).find((b) => b.textContent?.includes("accused_name"))!);
    await screen.findByText("No surfaces located yet.");
    fireEvent.change(screen.getByLabelText("Surface value"), { target: { value: "Ravi Kumar" } });
    fireEvent.click(screen.getByText("Locate"));
    await screen.findByText(/chars 0–10/);
    fireEvent.change(screen.getByLabelText("Surface value"), { target: { value: "Nobody Here" } });
    fireEvent.click(screen.getByText("Locate"));
    await screen.findByText(/not in text/);
  });

  it("edited text sends corrected with the new value", async () => {
    await login("officer@example.test", "password");
    render(<ReviewScreen caseId="case-1" />);
    await screen.findByLabelText("Review queue");
    fireEvent.click((await screen.findAllByRole("button")).find((b) => b.textContent?.includes("accused_name"))!);
    fireEvent.change(screen.getByLabelText("Recognised text"), { target: { value: "Ravi Kumari" } });
    fireEvent.click(screen.getByText(/Correct and Accept/));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0].body).toContain("corrected");
    expect(posted[0].body).toContain("Ravi Kumari");
  });
});
