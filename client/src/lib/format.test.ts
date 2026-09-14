import { describe, expect, it } from "vitest";
import { relativeTime, weekDelta } from "./format";

describe("relative timestamps (dashboard activity feed)", () => {
  const now = Date.parse("2025-11-02T14:00:00Z");

  it("renders minutes ago", () => {
    expect(relativeTime("2025-11-02T13:48:00Z", now)).toBe("12 min ago");
  });

  it("renders hours and days", () => {
    expect(relativeTime("2025-11-02T11:00:00Z", now)).toBe("3 h ago");
    expect(relativeTime("2025-10-30T14:00:00Z", now)).toBe("3 days ago");
  });

  it("never throws on garbage input", () => {
    expect(relativeTime("not-a-date", now)).toBe("unknown time");
  });
});

describe("real 7-day deltas (never hardcoded)", () => {
  const now = Date.parse("2025-11-02T14:00:00Z");

  it("counts only items newer than 7 days", () => {
    const delta = weekDelta(
      [
        { last_seen: "2025-11-01T10:00:00Z" },
        { last_seen: "2025-10-01T10:00:00Z" },
        { created_at: "2025-11-02T13:00:00Z" },
      ],
      now,
    );
    expect(delta).toEqual({ total: 3, newThisWeek: 2 });
  });

  it("ignores items without timestamps instead of guessing", () => {
    expect(weekDelta([{}, { last_seen: null }], now)).toEqual({ total: 2, newThisWeek: 0 });
  });
});
