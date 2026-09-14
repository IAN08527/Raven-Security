import { useEffect, useState } from "react";
import type { CvBoxesEvent, CvBoxesPayload } from "../types/api";

/**
 * API_CONTRACTS.md §2.6's `GET /cameras` exposes `stream_url` (the MJPEG
 * endpoint, §3.1) and `node_id`, but not the engine node's address directly
 * -- `GET /nodes` (§2.8) doesn't return it either. The overlay socket
 * (§3.2, `wss://{node}:8756/ws/cv/{camera_code}`) is on the same host as
 * `stream_url`, so it's derived from it: swap the scheme for its WS
 * equivalent and the `/stream/{code}.mjpg` path for `/ws/cv/{code}`. This is
 * UI wiring, not a data-model choice -- revisit if the contract ever
 * exposes the node address directly instead.
 */
export function deriveOverlayWsUrl(streamUrl: string, cameraCode: string): string {
  const url = new URL(streamUrl);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.pathname = `/ws/cv/${cameraCode}`;
  url.search = "";
  return url.toString();
}

export interface OverlayState {
  payload: CvBoxesPayload | null;
  connected: boolean;
}

const CLOSED: OverlayState = { payload: null, connected: false };

/**
 * One WebSocket per feed, independent of the feed's `<img>` MJPEG element
 * (D3, ARCHITECTURE.md §2): box updates re-render only the SVG overlay, at
 * whatever rate `cv.boxes` arrives, never touching the `<img>` and never
 * driving the MJPEG decode.
 */
export function useCvBoxesOverlay(streamUrl: string | null, cameraCode: string): OverlayState {
  const [state, setState] = useState<OverlayState>(CLOSED);

  useEffect(() => {
    if (!streamUrl) {
      setState(CLOSED);
      return;
    }

    let cancelled = false;
    const socket = new WebSocket(deriveOverlayWsUrl(streamUrl, cameraCode));

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
      let parsed: CvBoxesEvent;
      try {
        parsed = JSON.parse(event.data) as CvBoxesEvent;
      } catch {
        return; // malformed frame off the wire: drop it, keep the last good overlay
      }
      if (parsed.type !== "cv.boxes") return;
      setState({ payload: parsed.payload, connected: true });
    };

    return () => {
      cancelled = true;
      socket.close();
    };
  }, [streamUrl, cameraCode]);

  return state;
}
