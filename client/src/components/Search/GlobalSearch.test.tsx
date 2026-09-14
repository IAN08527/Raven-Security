import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GlobalSearch } from "./GlobalSearch";
import { login, resetSessionForTests } from "../../lib/session";

const PAGE = {
  entities: [
    {
      id: "e1",
      case_id: "case-1",
      type: "PERSON",
      canonical_name: "Ravi Kumar",
      provenance: "collected",
    },
    {
      id: "o1",
      case_id: "case-1",
      type: "ORGANIZATION",
      canonical_name: "Sharma Traders",
      provenance: "benchmark",
    },
  ],
  cases: [{ id: "case-1", case_code: "CA-001", title: "Alpha case" }],
  files: [{ id: "f1", case_id: "case-1", name: "seized-letter.pdf", provenance: "collected" }],
  identifiers: [{ entity_id: "e1", case_id: "case-1", value: "9822012345", provenance: "collected" }],
};

function stubSearch(): void {
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
      if (target.includes("/v1/search")) {
        if (target.includes("q=nothing-matching")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ entities: [], cases: [], files: [], identifiers: [] }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response(JSON.stringify(PAGE), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }),
  );
}

describe("global search", () => {
  beforeEach(() => {
    resetSessionForTests();
    vi.unstubAllGlobals();
  });

  it("renders grouped results with provenance and no risk content", async () => {
    stubSearch();
    await login("officer@example.test", "password");
    render(<GlobalSearch onOpenEntity={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Global search query"), { target: { value: "ravi" } });
    expect(await screen.findByText("Ravi Kumar")).toBeTruthy();
    expect(screen.getByText("seized-letter.pdf")).toBeTruthy();
    expect(screen.getByText("9822012345")).toBeTruthy();
    expect(screen.getByText("CA-001")).toBeTruthy();
    expect(screen.queryByText("Risk score")).toBeNull();
  });

  it("people tab shows only persons", async () => {
    stubSearch();
    await login("officer@example.test", "password");
    render(<GlobalSearch onOpenEntity={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Global search query"), { target: { value: "a" } });
    await screen.findByText("Ravi Kumar");
    fireEvent.click(screen.getByRole("tab", { name: "People" }));
    expect(screen.getByText("Ravi Kumar")).toBeTruthy();
    expect(screen.queryByText("Sharma Traders")).toBeNull();
    expect(screen.queryByText("seized-letter.pdf")).toBeNull();
  });

  it("empty results name the query and suggest next steps", async () => {
    stubSearch();
    await login("officer@example.test", "password");
    render(<GlobalSearch onOpenEntity={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Global search query"), {
      target: { value: "nothing-matching" },
    });
    expect(await screen.findByText(/No results for/)).toBeTruthy();
    expect(screen.getByText(/check spelling/i)).toBeTruthy();
  });

  it("clicking an entity opens its profile with its case", async () => {
    stubSearch();
    await login("officer@example.test", "password");
    const onOpenEntity = vi.fn();
    render(<GlobalSearch onOpenEntity={onOpenEntity} />);
    fireEvent.change(screen.getByLabelText("Global search query"), { target: { value: "ravi" } });
    fireEvent.click(await screen.findByText("Ravi Kumar"));
    expect(onOpenEntity).toHaveBeenCalledWith("e1", "case-1");
  });
});
