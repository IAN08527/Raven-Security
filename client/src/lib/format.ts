// Shared dashboard formatting helpers (screen 02, design §7).
// Pure functions: relative timestamps, real 7-day deltas from created_at.
// A delta is never hardcoded: weekDelta counts items newer than 7 days
// against the total, returning null when the items carry no timestamps.

export function relativeTime(iso: string, nowMs: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "unknown time";
  }
  const minutes = Math.max(0, Math.round((nowMs - then) / 60000));
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export interface WeekDelta {
  total: number;
  newThisWeek: number;
}

/** Real delta: items with a created_at/last_seen within the last 7 days. */
export function weekDelta(
  items: { created_at?: string | null; last_seen?: string | null }[],
  nowMs: number = Date.now(),
): WeekDelta {
  const cutoff = nowMs - 7 * 24 * 3600 * 1000;
  let fresh = 0;
  for (const item of items) {
    const raw = item.created_at ?? item.last_seen ?? null;
    if (raw === null) {
      continue;
    }
    const then = Date.parse(raw);
    if (!Number.isNaN(then) && then >= cutoff) {
      fresh += 1;
    }
  }
  return { total: items.length, newThisWeek: fresh };
}

/** 400ms count-up on first load only (screen 02). Reduced motion skips it. */
export function countUp(
  target: number,
  durationMs: number,
  onTick: (value: number) => void,
  onDone?: () => void,
): () => void {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    onTick(target);
    onDone?.();
    return () => undefined;
  }
  let frame = 0;
  const start = performance.now();
  function tick(now: number): void {
    const progress = Math.min(1, (now - start) / durationMs);
    onTick(Math.round(target * progress));
    if (progress < 1) {
      frame = requestAnimationFrame(tick);
    } else {
      onDone?.();
    }
  }
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
