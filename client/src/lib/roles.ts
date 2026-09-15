// Role-based navigation (M5-T4, design §5.2, §33).
//
// The sidebar removes items for other roles from the DOM entirely --
// never merely disabled. The server enforces the same boundary per
// endpoint (server/src/auth.rs), so a hidden item is unreachable, not
// just invisible.

import type { AppRole } from "../types/api";

// Generated type re-exported so existing `lib/roles` importers keep
// working; the wire shape lives in types/generated/ (D30).
export type { AppRole } from "../types/api";

export interface NavItem {
  id: string;
  label: string;
}

const ALL_ITEMS: NavItem[] = [
  { id: "home", label: "Home" },
  { id: "cases", label: "Cases" },
  { id: "ingestion", label: "Ingestion" },
  { id: "graph", label: "Graph" },
  { id: "cctv", label: "CCTV" },
  { id: "search", label: "Search" },
  { id: "map", label: "Map" },
  { id: "timeline", label: "Timeline" },
  { id: "reports", label: "Reports" },
  { id: "audit", label: "Audit" },
  { id: "settings", label: "Settings" },
];

// Map and timeline go to every case-content role for the same reason:
// movement and event history are case content, and the auditor reads
// assigned case content everywhere else. Admin stays excluded (D21).
const VISIBLE_BY_ROLE: Record<AppRole, string[]> = {
  io: ["home", "cases", "ingestion", "graph", "cctv", "search", "map", "timeline", "reports"],
  analyst: ["home", "cases", "graph", "cctv", "search", "map", "timeline", "reports"],
  auditor: ["home", "cases", "search", "map", "timeline", "audit"],
  admin: ["home", "cases", "settings"],
};

/** Nav items for a role, in shell order. Unknown roles see nothing. */
export function navItemsForRole(role: string): NavItem[] {
  const visible = (VISIBLE_BY_ROLE as Record<string, string[]>)[role];
  if (!visible) {
    return [];
  }
  return ALL_ITEMS.filter((item) => visible.includes(item.id));
}

/** Parse the role claim value; unknown values are rejected, never defaulted. */
export function parseRole(value: unknown): AppRole | null {
  if (value === "io" || value === "analyst" || value === "auditor" || value === "admin") {
    return value;
  }
  return null;
}
