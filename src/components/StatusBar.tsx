import { useVramState } from "../hooks/useVramState";
import { useRavenSocket } from "../hooks/useRavenSocket";

export function StatusBar({ onHealth }: { onHealth: () => void }) {
  const vram = useVramState();
  const { connected } = useRavenSocket();
  const holder = vram?.python === "up" ? "NLP_ACTIVE" : "IDLE";

  return (
    <footer className="flex h-6 items-center gap-4 border-t border-pd-border bg-pd-surface px-3 text-pd-xs text-pd-text-secondary">
      <span>OP-RAVEN-01</span>
      <span>{connected ? "ws:connected" : "ws:down"}</span>
      <span
        className={`rounded-full px-2 ${
          vram?.python === "up" ? "bg-pd-warning/15 text-pd-warning" : "bg-pd-elevated"
        }`}
      >
        GPU: {holder}
      </span>
      <button className="ml-auto hover:text-pd-text-primary" onClick={onHealth}>
        Health Board
      </button>
    </footer>
  );
}
