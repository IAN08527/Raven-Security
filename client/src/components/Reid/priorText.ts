import type { ExpectedWindow } from "../../types/api";

function hhmm(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * M2-T5, FR-5.6. The topology prior as human-readable text. All times are
 * case-clock (D16), rendered HH:MM UTC.
 */
export function formatPriorText(
  expectedWindow: ExpectedWindow | null,
  candidateTs: string,
  priorAdjustment: number,
): string {
  if (expectedWindow === null) {
    return "No topology expectation for this camera — standard threshold applied.";
  }
  const windowText = `${hhmm(expectedWindow.start)}–${hhmm(expectedWindow.end)}`;
  const arrivedText = hhmm(candidateTs);
  const start = new Date(expectedWindow.start).getTime();
  const end = new Date(expectedWindow.end).getTime();
  const arrived = new Date(candidateTs).getTime();
  const within = !Number.isNaN(start) && !Number.isNaN(end) && !Number.isNaN(arrived) && arrived >= start && arrived <= end;
  const tail =
    priorAdjustment === 0
      ? "no adjustment"
      : `threshold lowered by ${Math.abs(priorAdjustment).toFixed(2)}`;
  return `Expected arrival window: ${windowText}, candidate arrived at ${arrivedText} — ${
    within ? "within window" : "outside window"
  } (${tail}).`;
}
