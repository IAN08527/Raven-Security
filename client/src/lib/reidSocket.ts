import { useCallback, useEffect, useRef, useState } from "react";
import type { ReidCandidate, ReidCandidateEvent, ReidLostEvent } from "../types/api";

export interface LostBanner {
  cameraId: string;
  lastSeenTs: string;
}

interface ReidSocketState {
  candidates: ReidCandidate[];
  lost: LostBanner | null;
  /** Amount the operating threshold is currently lowered by (0 or 0.05). */
  widenAmount: number;
  widenActive: boolean;
  connected: boolean;
}

const CLOSED: ReidSocketState = {
  candidates: [],
  lost: null,
  widenAmount: 0,
  widenActive: false,
  connected: false,
};

let nextLocalId = -1;

function isReidCandidateEvent(parsed: unknown): parsed is ReidCandidateEvent {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { type?: unknown }).type === "reid.candidate"
  );
}

function isReidLostEvent(parsed: unknown): parsed is ReidLostEvent {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { type?: unknown }).type === "reid.lost"
  );
}

export interface AuditLogEntry {
  action: string;
  detail: string;
  at: string;
}

/**
 * M2-T5. Server WebSocket for Re-ID events (`wss://{server}:8443/v1/ws`,
 * API_CONTRACTS.md §2.9): `reid.candidate` proposals and `reid.lost`
 * loss notices for the active case. A loss is never silent (FR-5.8): it
 * stays bannered until a new candidate arrives or the operator explicitly
 * dismisses it -- no auto-timeout.
 *
 * "Widen search" lowers the acceptance threshold by 0.05 for the next 60
 * seconds and records the widening as an audit event. The countdown is a
 * plain timeout that flips state back; it never auto-decides anything.
 */
export function useReidEvents(serverWsUrl: string | null): ReidSocketState & {
  dismissLost: () => void;
  widenSearch: () => AuditLogEntry;
  applyCandidate: (candidate: ReidCandidate) => void;
} {
  const [state, setState] = useState<ReidSocketState>(CLOSED);
  const widenTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!serverWsUrl) {
      setState(CLOSED);
      return;
    }
    let cancelled = false;
    const socket = new WebSocket(serverWsUrl);
    socket.onopen = () => {
      if (!cancelled) setState((prev) => ({ ...prev, connected: true }));
    };
    const onDrop = (): void => {
      if (!cancelled) setState((prev) => ({ ...prev, connected: false }));
    };
    socket.onclose = onDrop;
    socket.onerror = onDrop;
    socket.onmessage = (event: MessageEvent<string>) => {
      if (cancelled) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data) as unknown;
      } catch {
        return;
      }
      if (isReidCandidateEvent(parsed)) {
        const payload = parsed.payload;
        const candidate: ReidCandidate = {
          id: nextLocalId--,
          target_id: payload.target_id,
          camera_id: payload.camera_id,
          ts: parsed.case_clock_ts ?? "",
          similarity: payload.similarity,
          threshold_used: payload.threshold_used,
          prior_adjustment: payload.prior_adjustment,
          expected_from: payload.expected_from,
          expected_window: payload.expected_window,
          crop_path: payload.crop_path,
          status: "proposed",
          // Fresh engine proposal: undecided, so no decider, no
          // decision time, no ledger anchor yet (generated Candidate
          // requires all three — null, not omitted).
          decided_by: null,
          decided_at: null,
          ledger_tx_id: null,
        };
        // A new proposal clears the lost banner: the search is producing
        // again, so there is no longer a loss to state.
        setState((prev) => ({
          ...prev,
          candidates: [...prev.candidates, candidate],
          lost: null,
        }));
      } else if (isReidLostEvent(parsed)) {
        setState((prev) => ({
          ...prev,
          lost: { cameraId: parsed.payload.camera_id, lastSeenTs: parsed.payload.last_seen_ts },
        }));
      }
    };
    return () => {
      cancelled = true;
      socket.close();
    };
  }, [serverWsUrl]);

  useEffect(() => {
    return () => {
      if (widenTimer.current !== null) window.clearTimeout(widenTimer.current);
    };
  }, []);

  const dismissLost = useCallback(() => {
    setState((prev) => ({ ...prev, lost: null }));
  }, []);

  const widenSearch = useCallback((): AuditLogEntry => {
    if (widenTimer.current !== null) window.clearTimeout(widenTimer.current);
    setState((prev) => ({ ...prev, widenAmount: 0.05, widenActive: true }));
    widenTimer.current = window.setTimeout(() => {
      setState((prev) => ({ ...prev, widenAmount: 0, widenActive: false }));
      widenTimer.current = null;
    }, 60_000);
    const entry: AuditLogEntry = {
      action: "reid.widen_search",
      detail: "threshold lowered by 0.05 for 60s",
      at: new Date().toISOString(),
    };
    return entry;
  }, []);

  const applyCandidate = useCallback((candidate: ReidCandidate) => {
    setState((prev) => ({
      ...prev,
      candidates: prev.candidates.some((c) => c.id === candidate.id)
        ? prev.candidates.map((c) => (c.id === candidate.id ? candidate : c))
        : [...prev.candidates, candidate],
    }));
  }, []);

  return { ...state, dismissLost, widenSearch, applyCandidate };
}

/** POST /candidates/{id}/decide (M2-T5, D9): single deliberate request. */
export async function decideCandidate(
  serverBase: string,
  sessionToken: string,
  candidateId: number,
  decision: "confirmed" | "rejected",
  note?: string,
): Promise<{ status: string; ledger_tx_id: string }> {
  const response = await fetch(`${serverBase}/candidates/${candidateId}/decide`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ decision, note }),
  });
  if (!response.ok) throw new Error(`decide failed: ${response.status}`);
  return (await response.json()) as { status: string; ledger_tx_id: string };
}
