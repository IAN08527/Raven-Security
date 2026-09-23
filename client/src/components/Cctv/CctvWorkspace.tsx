import { useEffect, useState } from "react";
import type { CameraView } from "../../types/api";
import { CameraWall } from "../CameraWall/CameraWall";
import { fetchCameras, fetchNodes, onlineCameraCodes } from "../../lib/health";

// CCTV Monitoring (reference middle-left, design §10). All registered
// cameras render simultaneously; display is independent of inference
// (FR-5.1). The full §2.6 shape is not served yet, so stream_url stays
// null and tiles show the honest unavailable placeholder until it is.

export function CctvWorkspace(): JSX.Element {
  const [cameras, setCameras] = useState<CameraView[]>([]);
  const [note, setNote] = useState("Loading cameras…");
  const [activeCode, setActiveCode] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const [nodes, serverCameras] = await Promise.all([fetchNodes(), fetchCameras()]);
        if (cancelled) return;
        const online = onlineCameraCodes(nodes);
        setCameras(
          serverCameras.map((c) => ({
            id: c.id,
            code: c.code,
            label: c.code,
            lat: null,
            lon: null,
            mode: "live" as const,
            declared_start_ts: c.declared_start_ts,
            fps: c.fps,
            effective_fps: null,
            status: online.has(c.code) ? ("online" as const) : ("offline" as const),
            node_id: null,
            stream_url: null,
          })),
        );
        setNote(
          serverCameras.length === 0
            ? "No cameras registered. Register one in Settings."
            : `${serverCameras.length} camera(s), ${online.size} online by node status.`,
        );
        if (serverCameras.length > 0) setActiveCode(serverCameras[0].code);
      } catch (err) {
        if (!cancelled) setNote(err instanceof Error ? err.message : "Cameras unavailable.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const active = cameras.find((c) => c.code === activeCode) ?? null;

  return (
    <div className="flex h-full flex-col bg-[#151514] text-[#E8E5DD]">
      <header className="flex items-center justify-between border-b border-[#30302D] bg-[#1B1B19] px-4 py-2">
        <div>
          <h1 className="text-lg text-[#E8E5DD]">CCTV Monitoring</h1>
          <p className="text-[11px] text-[#A5A29A]">Live feeds, detections and cross-camera tracking.</p>
        </div>
        <span className="text-[11px] text-[#A5A29A]">{note}</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <CameraWall cameras={cameras} />
        </div>
        <aside className="w-64 shrink-0 border-l border-[#30302D] bg-[#1B1B19] p-3 text-xs">
          <h2 className="text-sm font-semibold text-[#E8E5DD]">Camera Details</h2>
          {active ? (
            <dl className="mt-2 flex flex-col gap-1">
              <div className="flex justify-between"><dt className="text-[#706E68]">Camera</dt><dd className="font-mono text-[#E8E5DD]">{active.code}</dd></div>
              <div className="flex justify-between"><dt className="text-[#706E68]">Status</dt><dd className="text-[#E8E5DD]">{active.status}</dd></div>
              <div className="flex justify-between"><dt className="text-[#706E68]">Declared start</dt><dd className="font-mono text-[#A5A29A]">{active.declared_start_ts.slice(0, 10)}</dd></div>
              <div className="flex justify-between"><dt className="text-[#706E68]">FPS</dt><dd className="text-[#E8E5DD]">{active.fps}</dd></div>
            </dl>
          ) : (
            <p className="mt-2 text-[#706E68]">No camera selected.</p>
          )}
          <h3 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[#706E68]">Cameras</h3>
          <ul className="mt-1 flex max-h-64 flex-col gap-1 overflow-auto">
            {cameras.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setActiveCode(c.code)}
                  className={`flex w-full items-center gap-2 border px-2 py-1 text-left ${
                    c.code === activeCode ? "border-[#4A4945] bg-[#262624]" : "border-[#30302D]"
                  }`}
                >
                  <span className={`inline-block h-2 w-2 rounded-full ${c.status === "online" ? "bg-[#4FAE79]" : "bg-[#D8665C]"}`} />
                  <span className="font-mono text-[#E8E5DD]">{c.code}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-[#706E68]">
            Detection boxes and lock-on need a live engine-node socket (§3.2); tiles show the
            unavailable state until then. Candidates are always proposals — a human confirms
            before anything enters the case record.
          </p>
        </aside>
      </div>
    </div>
  );
}
