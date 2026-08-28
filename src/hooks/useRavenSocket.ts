import { useEffect, useState } from "react";
import type { WebSocketEvent } from "../types/generated";

export function useRavenSocket(onEvent?: (e: WebSocketEvent) => void) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket;
    try {
      ws = new WebSocket("ws://127.0.0.1:8756/ws/events");
      ws.onopen = () => setConnected(true);
      ws.onclose = () => setConnected(false);
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as WebSocketEvent;
          onEvent?.(data);
        } catch {
          /* ignore malformed */
        }
      };
    } catch {
      setConnected(false);
    }
    return () => ws?.close();
  }, [onEvent]);

  return { connected };
}
