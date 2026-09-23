import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { UserManagement } from "./UserManagement";
import { login, resetSessionForTests } from "../../lib/session";

let users: { id: string; email: string; badge_no: string; full_name: string; role: string; active: boolean }[];

function stubAdmin(): void {
  users = [
    { id: "u1", email: "io@example.test", badge_no: "MH-1", full_name: "I Officer", role: "io", active: true },
  ];
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
      if (target.endsWith("/admin/users") && (!init?.method || init.method === "GET")) {
        return Promise.resolve(new Response(JSON.stringify(users), { status: 200 }));
      }
      if (target.endsWith("/admin/users") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          id: string;
          email: string;
          badge_no: string;
          full_name: string;
          role: string;
        };
        if (users.some((user) => user.email === body.email)) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: { code: "CONFLICT", message: "dup", detail: {}, retryable: false, trace_id: "t" } }), {
              status: 409,
            }),
          );
        }
        const created = { active: true, ...body, id: body.id || "u2" };
        users.push(created);
        return Promise.resolve(new Response(JSON.stringify(created), { status: 201 }));
      }
      const patch = target.match(/\/admin\/users\/(.+)$/);
      if (patch && init?.method === "PATCH") {
        const user = users.find((candidate) => candidate.id === patch[1]);
        if (!user) return Promise.resolve(new Response("{}", { status: 404 }));
        user.active = (JSON.parse(String(init.body)) as { active: boolean }).active;
        return Promise.resolve(new Response(JSON.stringify(user), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }),
  );
}

describe("user management", () => {
  beforeEach(() => {
    resetSessionForTests();
    vi.unstubAllGlobals();
  });

  it("lists users and creates a new one", async () => {
    stubAdmin();
    await login("admin@example.test", "password");
    render(<UserManagement />);
    expect(await screen.findByText("io@example.test")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Auth user id"), { target: { value: "u2" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.test" } });
    fireEvent.change(screen.getByLabelText("Badge number"), { target: { value: "MH-9" } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "New Officer" } });
    fireEvent.click(screen.getByText("Create"));
    expect(await screen.findByText("new@example.test")).toBeTruthy();
  });

  it("duplicate email surfaces the conflict", async () => {
    stubAdmin();
    await login("admin@example.test", "password");
    render(<UserManagement />);
    await screen.findByText("io@example.test");
    fireEvent.change(screen.getByLabelText("Auth user id"), { target: { value: "u3" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "io@example.test" } });
    fireEvent.change(screen.getByLabelText("Badge number"), { target: { value: "MH-9" } });
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Dup" } });
    fireEvent.click(screen.getByText("Create"));
    expect(await screen.findByText(/CONFLICT/)).toBeTruthy();
  });

  it("deactivation is two-step and never deletes", async () => {
    stubAdmin();
    await login("admin@example.test", "password");
    render(<UserManagement />);
    await screen.findByText("io@example.test");
    // One click arms the confirm; the row is still active.
    fireEvent.click(screen.getByText("Deactivate"));
    expect(await screen.findByText("Confirm deactivate")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    fireEvent.click(screen.getByText("Confirm deactivate"));
    expect(await screen.findByText("Deactivated")).toBeTruthy();
    // The row survives with its trail intact.
    expect(screen.getByText("io@example.test")).toBeTruthy();
  });
});
