import { describe, expect, it } from "vitest";
import { navItemsForRole, parseRole } from "./roles";

function ids(role: string): string[] {
  return navItemsForRole(role).map((item) => item.id);
}

describe("role-based navigation (design §5.2, §33)", () => {
  it("io sees casework items but not Audit", () => {
    expect(ids("io")).toEqual(["home", "cases", "ingestion", "graph", "cctv", "search", "map", "timeline", "reports"]);
  });

  it("analyst sees analytical views but not Ingestion or Audit", () => {
    expect(ids("analyst")).toEqual(["home", "cases", "graph", "cctv", "search", "map", "timeline", "reports"]);
  });

  it("auditor sees Audit but not CCTV or Ingestion", () => {
    // Shell order (design §5.2), not the task's listing order.
    expect(ids("auditor")).toEqual(["home", "cases", "search", "map", "timeline", "audit"]);
  });

  it("admin sees every read-only case-content screen plus Settings, but not Ingestion", () => {
    expect(ids("admin")).toEqual([
      "home",
      "cases",
      "graph",
      "cctv",
      "search",
      "map",
      "timeline",
      "reports",
      "audit",
      "settings",
    ]);
  });

  it("unknown roles see nothing rather than everything", () => {
    expect(ids("superuser")).toEqual([]);
  });

  it("parseRole rejects unknown values instead of defaulting", () => {
    expect(parseRole("superuser")).toBeNull();
    expect(parseRole("io")).toBe("io");
  });
});
