import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
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
      id: "e2",
      case_id: "case-1",
      type: "PERSON",
      canonical_name: "Suresh Yadav",
      provenance: "collected",
    },
  ],
  cases: [],
  files: [],
  identifiers: [],
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
        return Promise.resolve(new Response(JSON.stringify(PAGE), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }),
  );
}

function renderPalette(handlers: { onOpenEntity?: (entityId: string, caseId: string) => void } = {}): {
  onOpenEntity: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
} {
  const onOpenEntity = vi.fn(handlers.onOpenEntity ?? (() => undefined));
  const onClose = vi.fn();
  render(<CommandPalette open onClose={onClose} onOpenEntity={onOpenEntity} />);
  return { onOpenEntity, onClose };
}

describe("command palette", () => {
  beforeEach(() => {
    resetSessionForTests();
    vi.unstubAllGlobals();
  });

  it("enter opens the top result and closes", async () => {
    stubSearch();
    await login("officer@example.test", "password");
    const { onOpenEntity, onClose } = renderPalette();
    fireEvent.change(screen.getByLabelText("Command palette search"), { target: { value: "ravi" } });
    await screen.findByText("Ravi Kumar");
    fireEvent.keyDown(screen.getByLabelText("Command palette search"), { key: "Enter" });
    expect(onOpenEntity).toHaveBeenCalledWith("e1", "case-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("arrow keys move and escape closes", async () => {
    stubSearch();
    await login("officer@example.test", "password");
    const { onOpenEntity, onClose } = renderPalette();
    const box = screen.getByLabelText("Command palette search");
    fireEvent.change(box, { target: { value: "a" } });
    await screen.findByText("Suresh Yadav");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onOpenEntity).toHaveBeenCalledWith("e2", "case-1");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("a chosen query returns as a recent search", async () => {
    stubSearch();
    await login("officer@example.test", "password");
    const { unmount } = render(
      <CommandPalette open onClose={vi.fn()} onOpenEntity={vi.fn()} />,
    );
    const box = screen.getByLabelText("Command palette search");
    fireEvent.change(box, { target: { value: "ravi-unique-query" } });
    await screen.findByText("Ravi Kumar");
    fireEvent.keyDown(box, { key: "Enter" });
    unmount();
    render(<CommandPalette open onClose={vi.fn()} onOpenEntity={vi.fn()} />);
    expect(await screen.findByText("ravi-unique-query")).toBeTruthy();
  });
});
