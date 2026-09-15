import { useEffect, useState } from "react";
import { fetchCameras, registerCamera, type Camera } from "../../lib/health";

/**
 * Settings — cameras (FR-8.1). Lists registered cameras and registers
 * new ones with an explicit declared_start_ts (D16: required, no
 * default). Topology edges, declared_start_ts edits, form templates
 * and weight parameters have no backend endpoints yet, so each is an
 * honest gap note below naming the missing piece — never a mock form
 * that pretends to save.
 */
export function CameraSettings(): JSX.Element {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [declaredStart, setDeclaredStart] = useState("");
  const [fps, setFps] = useState("10");
  const [formError, setFormError] = useState<string | null>(null);

  async function reload(): Promise<void> {
    try {
      setCameras(await fetchCameras());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cameras unavailable.");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function add(): Promise<void> {
    setFormError(null);
    const fpsValue = Number(fps);
    if (!code.trim() || !label.trim() || !declaredStart || !Number.isFinite(fpsValue)) {
      setFormError("Code, label, declared start and a numeric FPS are all required.");
      return;
    }
    try {
      await registerCamera({
        code: code.trim(),
        label: label.trim(),
        declared_start_ts: new Date(`${declaredStart}:00Z`).toISOString(),
        fps: fpsValue,
      });
      setCode("");
      setLabel("");
      setDeclaredStart("");
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Camera was not registered.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-sm border border-neutral-800 bg-neutral-900 p-3">
        <h3 className="mb-2 text-sm font-semibold text-neutral-100">Register camera</h3>
        <div className="flex max-w-3xl flex-wrap gap-2">
          <input
            aria-label="Camera code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="cam_01"
            className="w-32 border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          />
          <input
            aria-label="Camera label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Gate"
            className="w-48 border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          />
          <input
            aria-label="Declared start"
            type="datetime-local"
            value={declaredStart}
            onChange={(event) => setDeclaredStart(event.target.value)}
            className="border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          />
          <input
            aria-label="FPS"
            value={fps}
            onChange={(event) => setFps(event.target.value)}
            placeholder="10"
            inputMode="decimal"
            className="w-20 border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          />
          <button
            type="button"
            onClick={() => void add()}
            className="rounded-sm bg-neutral-800 px-3 py-1 text-sm font-semibold text-neutral-100"
          >
            Register
          </button>
        </div>
        {formError && (
          <p role="alert" className="mt-2 text-xs text-red-400">
            {formError}
          </p>
        )}
      </section>

      <section className="rounded-sm border border-neutral-800 bg-neutral-900 p-3">
        <h3 className="mb-2 text-sm font-semibold text-neutral-100">Registered cameras</h3>
        {error ? (
          <p role="alert" className="text-xs text-red-400">
            {error}
          </p>
        ) : cameras.length === 0 ? (
          <p className="text-xs text-neutral-500">No cameras registered.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {cameras.map((camera) => (
              <li
                key={camera.id}
                className="rounded-sm border border-neutral-800 bg-neutral-950 p-2 text-xs"
              >
                <span className="font-semibold text-neutral-100">{camera.label || camera.code}</span>
                <span className="ml-2 font-mono text-neutral-500">{camera.code}</span>
                <span className="mt-0.5 block font-mono text-[11px] text-neutral-500">
                  start {camera.declared_start_ts} · {camera.fps} fps
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-sm border border-neutral-800 bg-neutral-900 p-3">
        <h3 className="mb-2 text-sm font-semibold text-neutral-100">Not yet manageable here</h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-neutral-500">
          <li>Camera topology edges — needs POST /camera-edges (no backend endpoint).</li>
          <li>Declared-start edits — needs a camera update endpoint (registration only).</li>
          <li>Form templates — needs template listing endpoints (FR-8.2).</li>
          <li>Weight parameters — needs a read endpoint; changes require a migration (D27).</li>
        </ul>
      </section>
    </div>
  );
}
