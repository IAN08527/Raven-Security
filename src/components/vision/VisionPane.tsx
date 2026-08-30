import { useCallback, useMemo, useState } from "react";
import { Check, Crosshair, Loader2, Square, Video, X } from "lucide-react";
import { invokeRaven } from "../../hooks/useInvoke";
import { useRavenSocket } from "../../hooks/useRavenSocket";
import { useCaseStore } from "../../store/case";
import type {
  ConfirmResult,
  CVBox,
  CVDetections,
  CVSighting,
  LockResult,
  TrackingResult,
  WebSocketEvent,
} from "../../types/generated";

const ENGINE = "http://127.0.0.1:8756";
const CAMERAS = ["cam_01", "cam_02", "cam_03", "cam_04"];

export function VisionPane() {
  const [activeCam, setActiveCam] = useState<string | null>(null);
  const [session, setSession] = useState<TrackingResult | null>(null);
  const [boxes, setBoxes] = useState<CVBox[]>([]);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  const [locked, setLocked] = useState<number | null>(null);
  const [lock, setLock] = useState<LockResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Downstream sightings stream in on ANY camera (not just the viewed one), so
  // they live outside the activeCam filter. Keyed newest-first.
  const [sightings, setSightings] = useState<CVSighting[]>([]);
  // sighting_id -> review outcome, so a reviewed card shows its verdict + tx.
  const [reviews, setReviews] = useState<
    Record<number, { action: "confirm" | "reject"; res: ConfirmResult }>
  >({});
  const caseId = useCaseStore((s) => s.caseId);
  const selectedEntityId = useCaseStore((s) => s.selectedEntityId);

  // Detection boxes (cv.detections) are for the viewed camera; sightings
  // (cv.sighting) arrive from downstream cameras and feed the review panel.
  const onEvent = useCallback(
    (e: WebSocketEvent) => {
      if (e.type === "cv.detections") {
        const p = e.payload as unknown as CVDetections;
        if (!activeCam || p.camera_code !== activeCam) return;
        setBoxes(p.boxes ?? []);
        if (p.frame_w && p.frame_h) setFrame({ w: p.frame_w, h: p.frame_h });
        return;
      }
      if (e.type === "cv.sighting") {
        const s = e.payload as unknown as CVSighting;
        setSightings((prev) => [s, ...prev].slice(0, 30));
      }
    },
    [activeCam],
  );

  const { connected } = useRavenSocket(onEvent);

  const trackIds = useMemo(
    () => Array.from(new Set(boxes.map((b) => b.track_id))).sort((a, b) => a - b),
    [boxes],
  );

  async function selectCamera(cam: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setBoxes([]);
    setFrame(null);
    setLocked(null);
    setLock(null);
    setActiveCam(cam);
    try {
      const res = await invokeRaven<TrackingResult>("start_tracking", {
        cameraCode: cam,
      });
      setSession(res);
    } catch (e) {
      setSession(null);
      setError(`start_tracking failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function lockOn(trackId: number) {
    if (!session || busy) return;
    if (!caseId) {
      setError("lock_on failed: no active case selected");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await invokeRaven<LockResult>("lock_on_target", {
        sessionId: session.session_id,
        trackId,
        label: `Target ${String(trackId).padStart(2, "0")}`,
        caseId,
        // Optional identity link: whatever entity is selected in the graph gets
        // its edges scored when a downstream sighting is later confirmed.
        entityId: selectedEntityId ?? null,
      });
      setLocked(trackId);
      setLock(res);
    } catch (e) {
      setError(`lock_on failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function review(sightingId: number, action: "confirm" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const res = await invokeRaven<ConfirmResult>("confirm_sighting", {
        sightingId,
        action,
        note: null,
      });
      setReviews((prev) => ({ ...prev, [sightingId]: { action, res } }));
    } catch (e) {
      setError(`confirm_sighting failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!session) return;
    setBusy(true);
    try {
      await invokeRaven("stop_tracking", { sessionId: session.session_id });
    } catch (e) {
      setError(`stop failed: ${String(e)}`);
    } finally {
      setSession(null);
      setActiveCam(null);
      setBoxes([]);
      setFrame(null);
      setLocked(null);
      setLock(null);
      setSightings([]);
      setReviews({});
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full bg-pd-base">
      {/* Camera selector */}
      <div className="flex w-32 flex-col border-r border-pd-border bg-pd-surface">
        <div className="flex h-9 items-center gap-1.5 border-b border-pd-border px-3 text-pd-xs uppercase tracking-wide text-pd-text-tertiary">
          <Video size={12} /> Cameras
        </div>
        {CAMERAS.map((c) => (
          <button
            key={c}
            onClick={() => selectCamera(c)}
            disabled={busy}
            className={`flex h-9 items-center border-b border-pd-border px-3 text-left text-pd-sm hover:bg-pd-elevated disabled:opacity-50 ${
              activeCam === c
                ? "bg-pd-elevated text-pd-accent"
                : "text-pd-text-secondary"
            }`}
          >
            {c}
          </button>
        ))}
        <div className="mt-auto border-t border-pd-border px-3 py-2 text-pd-xs text-pd-text-tertiary">
          <span
            className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
              connected ? "bg-pd-success" : "bg-pd-text-tertiary"
            }`}
          />
          {connected ? "events live" : "events offline"}
        </div>
      </div>

      {/* Video canvas + overlay */}
      <div className="relative min-w-0 flex-1">
        {session ? (
          <>
            <img
              src={`${ENGINE}${session.stream_url}`}
              className="h-full w-full object-contain"
              alt={`feed ${activeCam}`}
            />
            {frame && (
              <svg
                viewBox={`0 0 ${frame.w} ${frame.h}`}
                preserveAspectRatio="xMidYMid meet"
                className="absolute inset-0 h-full w-full"
              >
                {boxes.map((b) => {
                  const active = b.track_id === locked;
                  return (
                    <g
                      key={b.track_id}
                      className="cursor-pointer"
                      onClick={() => lockOn(b.track_id)}
                    >
                      <rect
                        x={b.x}
                        y={b.y}
                        width={b.w}
                        height={b.h}
                        fill="none"
                        stroke={active ? "#f85149" : "#58a6ff"}
                        strokeWidth={active ? 3 : 2}
                      />
                      <text
                        x={b.x}
                        y={b.y - 4}
                        fontSize={14}
                        fill={active ? "#f85149" : "#58a6ff"}
                      >
                        {String(b.track_id).padStart(2, "0")}
                        {active ? " ●" : ""}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-pd-text-secondary">
            {busy ? (
              <span className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" /> Starting feed…
              </span>
            ) : (
              "Select a camera feed"
            )}
          </div>
        )}
        {error && (
          <div className="absolute bottom-2 left-2 right-2 rounded border border-pd-danger/40 bg-pd-danger/10 px-2 py-1 text-pd-xs text-pd-danger">
            {error}
          </div>
        )}
      </div>

      {/* Detected targets / lock-on panel */}
      <div className="flex w-48 flex-col border-l border-pd-border bg-pd-surface">
        <div className="flex h-9 items-center justify-between border-b border-pd-border px-3 text-pd-xs uppercase tracking-wide text-pd-text-tertiary">
          <span>Detected</span>
          {session && (
            <button
              onClick={stop}
              disabled={busy}
              className="flex items-center gap-1 text-pd-text-secondary hover:text-pd-danger disabled:opacity-50"
              title="Stop tracking"
            >
              <Square size={11} /> Stop
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {trackIds.length === 0 ? (
            <div className="px-3 py-3 text-pd-xs text-pd-text-tertiary">
              {session ? "No detections yet" : "Idle"}
            </div>
          ) : (
            trackIds.map((id) => (
              <button
                key={id}
                onClick={() => lockOn(id)}
                disabled={busy}
                className={`flex w-full items-center gap-2 border-b border-pd-border px-3 py-2 text-left text-pd-sm hover:bg-pd-elevated disabled:opacity-50 ${
                  id === locked ? "text-pd-danger" : "text-pd-text-secondary"
                }`}
              >
                <Crosshair size={13} />
                <span className="font-mono">
                  {String(id).padStart(2, "0")}
                </span>
                {id === locked && (
                  <span className="ml-auto text-pd-xs">LOCKED</span>
                )}
              </button>
            ))
          )}
        </div>

        {lock && (
          <div className="border-t border-pd-border px-3 py-2 text-pd-xs">
            <div className="text-pd-text-tertiary">
              Lock {lock.ledger_status === "anchored" ? "anchored" : "pending"}
            </div>
            <div className="mt-1 truncate font-mono text-pd-text-secondary" title={lock.tx_id}>
              tx: {lock.tx_id || "—"}
            </div>
            <div className="mt-1 text-pd-text-tertiary">
              {selectedEntityId
                ? "linked to selected entity"
                : "no entity selected — confirms won't score the graph"}
            </div>
          </div>
        )}
      </div>

      {/* Sightings review panel (Phase 5, FR-2.3) */}
      <div className="flex w-56 flex-col border-l border-pd-border bg-pd-surface">
        <div className="flex h-9 items-center gap-1.5 border-b border-pd-border px-3 text-pd-xs uppercase tracking-wide text-pd-text-tertiary">
          <Crosshair size={12} /> Sightings
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sightings.length === 0 ? (
            <div className="px-3 py-3 text-pd-xs text-pd-text-tertiary">
              No sightings yet
            </div>
          ) : (
            sightings.map((s, i) => {
              const rv = s.sighting_id != null ? reviews[s.sighting_id] : undefined;
              const frameName = s.frame_path?.split(/[\\/]/).pop();
              return (
                <div
                  key={`${s.sighting_id ?? "x"}-${s.ts}-${i}`}
                  className="border-b border-pd-border px-3 py-2 text-pd-xs"
                >
                  <div className="flex items-center gap-2">
                    {frameName && (
                      <img
                        src={`${ENGINE}/cv/sightings/${frameName}`}
                        alt="sighting crop"
                        className="h-10 w-10 rounded border border-pd-border object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="font-mono text-pd-text-secondary">
                        {s.camera_code}
                      </div>
                      <div className="text-pd-text-tertiary">
                        sim {s.similarity.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  {rv ? (
                    <div className="mt-1.5 text-pd-text-tertiary">
                      {rv.action === "confirm" ? "Confirmed" : "Rejected"}
                      {rv.action === "confirm" && rv.res.edges_bumped > 0 && (
                        <span> · +{rv.res.edges_bumped} edge(s)</span>
                      )}
                      <div className="truncate font-mono" title={rv.res.tx_id}>
                        tx: {rv.res.tx_id || "—"}
                      </div>
                    </div>
                  ) : s.sighting_id == null ? (
                    <div className="mt-1.5 text-pd-text-tertiary">
                      not persisted (DB offline)
                    </div>
                  ) : (
                    <div className="mt-1.5 flex gap-1.5">
                      <button
                        onClick={() => review(s.sighting_id!, "confirm")}
                        disabled={busy}
                        className="flex flex-1 items-center justify-center gap-1 rounded border border-pd-success/40 py-1 text-pd-success hover:bg-pd-success/10 disabled:opacity-50"
                      >
                        <Check size={11} /> Confirm
                      </button>
                      <button
                        onClick={() => review(s.sighting_id!, "reject")}
                        disabled={busy}
                        className="flex flex-1 items-center justify-center gap-1 rounded border border-pd-danger/40 py-1 text-pd-danger hover:bg-pd-danger/10 disabled:opacity-50"
                      >
                        <X size={11} /> Reject
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
