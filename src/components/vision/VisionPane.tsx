import { useState } from "react";
import { useCaseStore } from "../../store/case";

export function VisionPane() {
  const [session, setSession] = useState<string | null>(null);

  return (
    <div className="flex h-full bg-pd-base">
      <div className="flex flex-col border-r border-pd-border bg-pd-surface">
        {["cam_01", "cam_02", "cam_03", "cam_04"].map((c) => (
          <button
            key={c}
            onClick={() => setSession(c)}
            className="h-9 border-b border-pd-border px-3 text-left text-pd-sm text-pd-text-secondary hover:bg-pd-elevated"
          >
            {c}
          </button>
        ))}
      </div>
      <div className="relative flex-1">
        {session ? (
          <>
            <img
              src={`http://127.0.0.1:8756/cv/stream/${session}.mjpg`}
              className="h-full w-full object-contain"
              alt="cctv"
            />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-pd-text-secondary">
            Select a camera feed
          </div>
        )}
      </div>
    </div>
  );
}
