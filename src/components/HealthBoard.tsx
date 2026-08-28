import { useVramState } from "../hooks/useVramState";

const services = ["supabase", "neo4j", "ollama", "fabric", "python"] as const;

export function HealthBoard({ onClose }: { onClose: () => void }) {
  const vram = useVramState();

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-pd-base/75">
      <div className="w-[480px] rounded-pd-lg border border-pd-border bg-pd-surface p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-pd-lg font-medium">Startup Health Gate</h2>
          <button className="text-pd-text-tertiary hover:text-pd-danger" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="space-y-2">
          {services.map((s) => {
            const up = vram ? (vram[s] as string) === "up" : false;
            return (
              <div key={s} className="flex items-center justify-between rounded-pd-sm bg-pd-elevated px-3 py-2">
                <span className="capitalize text-pd-base">{s}</span>
                <span className={up ? "text-pd-success" : "text-pd-danger"}>
                  {vram ? (up ? "● up" : "● down") : "● …"}
                </span>
              </div>
            );
          })}
          <div className="flex items-center justify-between rounded-pd-sm bg-pd-elevated px-3 py-2">
            <span className="text-pd-base">VRAM free</span>
            <span className="font-mono text-pd-base text-pd-text-primary">
              {vram ? `${vram.vram_free_mb.toFixed(0)} MB` : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
