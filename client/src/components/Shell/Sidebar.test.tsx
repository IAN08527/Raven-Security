import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import type { AppRole } from "../../lib/roles";

function renderSidebar(role: AppRole): void {
  render(
    <Sidebar
      role={role}
      user={{ badge: "B-1", name: "Test User", role }}
      health="online"
      active="home"
      onNavigate={vi.fn()}
    />
  );
}

describe("role-based sidebar removes items from the DOM (design §33)", () => {
  it("io does not see Audit", () => {
    renderSidebar("io");
    expect(screen.queryByText("Audit")).toBeNull();
    expect(screen.getByText("Ingestion")).toBeTruthy();
  });

  it("auditor does not see CCTV or Ingestion", () => {
    renderSidebar("auditor");
    expect(screen.queryByText("CCTV")).toBeNull();
    expect(screen.queryByText("Ingestion")).toBeNull();
    expect(screen.getByText("Audit")).toBeTruthy();
  });

  it("admin sees Graph, CCTV and Audit for oversight but not Ingestion", () => {
    renderSidebar("admin");
    expect(screen.getByText("Graph")).toBeTruthy();
    expect(screen.getByText("CCTV")).toBeTruthy();
    expect(screen.getByText("Audit")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(screen.queryByText("Ingestion")).toBeNull();
  });
});
