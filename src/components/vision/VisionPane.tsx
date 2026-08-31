import { useCallback, useMemo, useState } from "react";
import {
  Activity,
  Check,
  Crosshair,
  Eye,
  Loader2,
  Lock,
  Play,
  Pause,
  Square,
  Video,
  X,
} from "lucide-react";
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
const CAMERAS = [
  { id: "cam_01", label: "CAM-01: Main Gate - East Wing" },
  { id: "cam_02", label: "CAM-02: North Crossing - Cam B" },
  { id: "cam_03", label: "CAM-03: South Highway Tollgate" },
  { id: "cam_04", label: "CAM-04: Metro Station Exit 2" },
];

interface DetectedPerson {
  id: string;
  trackId: number;
  label: string;
  confidence: number;
  status: "Target Lock-On" | "Pedestrian";
}

const DEFAULT_PERSONS: DetectedPerson[] = [
  { id: "01", trackId: 1, label: "Pedestrian", confidence: 90, status: "Pedestrian" },
  { id: "02", trackId: 2, label: "Pedestrian", confidence: 95, status: "Pedestrian" },
  { id: "03", trackId: 3, label: "Target Lock-On", confidence: 98, status: "Target Lock-On" },
  { id: "04", trackId: 4, label: "Pedestrian", confidence: 91, status: "Pedestrian" },
  { id: "05", trackId: 5, label: "Pedestrian", confidence: 88, status: "Pedestrian" },
];

export function VisionPane() {
  const [activeCam, setActiveCam] = useState<string>("cam_01");
  const [session, setSession] = useState<TrackingResult | null>(null);
  const [boxes, setBoxes] = useState<CVBox[]>([]);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  const [locked, setLocked] = useState<number | null>(3);
  const [lock, setLock] = useState<LockResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);

  // Downstream sightings stream in on ANY camera (not just the viewed one)
  const [sightings, setSightings] = useState<CVSighting[]>([]);
  // sighting_id -> review outcome
  const [reviews, setReviews] = useState<
    Record<number, { action: "confirm" | "reject"; res: ConfirmResult }>
  >({});

  const caseId = useCaseStore((s) => s.caseId);
  const selectedEntityId = useCaseStore((s) => s.selectedEntityId);

  // Detection boxes for viewed camera; sightings arrive from downstream cameras
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

  const trackIds = useMemo(() => {
    if (boxes.length > 0) {
      return Array.from(new Set(boxes.map((b) => b.track_id))).sort((a, b) => a - b);
    }
    return DEFAULT_PERSONS.map((p) => p.trackId);
  }, [boxes]);

  async function startCamera(cam: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setBoxes([]);
    setFrame(null);
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
    if (busy) return;
    setBusy(true);
    setError(null);
    setLocked(trackId);
    try {
      if (session) {
        const res = await invokeRaven<LockResult>("lock_on_target", {
          sessionId: session.session_id,
          trackId,
          label: `Target ${String(trackId).padStart(2, "0")}`,
          caseId: caseId || "OP-RAVEN-01",
          entityId: selectedEntityId ?? null,
        });
        setLock(res);
      }
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
      setBoxes([]);
      setFrame(null);
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-pd-base text-pd-text-primary overflow-hidden select-none">
      {/* TOP CONTROLS BAR */}
      <div className="flex items-center justify-between border-b border-pd-border bg-pd-surface px-4 py-2">
        <div className="flex items-center gap-3">
          {/* Camera Selector Dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-pd-xs text-pd-text-tertiary">Feed:</span>
            <select
              value={activeCam}
              onChange={(e) => {
                const newCam = e.target.value;
                setActiveCam(newCam);
                if (session) startCamera(newCam);
              }}
              className="h-7 rounded border border-pd-border bg-pd-elevated px-2 text-pd-xs font-mono text-pd-text-primary focus:border-pd-accent focus:outline-none"
            >
              {CAMERAS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <span className="flex items-center gap-1 rounded bg-pd-success/15 border border-pd-success/30 px-2 py-0.5 text-[10px] font-mono font-semibold text-pd-success">
            <span className="h-1.5 w-1.5 rounded-full bg-pd-success animate-pulse" />
            LIVE 1080p 30fps
          </span>

          <span className="font-mono text-pd-xs text-pd-text-tertiary">
            YOLOv8 + OSNet Re-ID Active
          </span>

          <span
            className={`flex items-center gap-1 text-[11px] font-mono ${
              connected ? "text-pd-success" : "text-pd-text-tertiary"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connected ? "bg-pd-success" : "bg-pd-text-tertiary"
              }`}
            />
            {connected ? "Events Live" : "Events Standby"}
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {session ? (
            <button
              onClick={stop}
              disabled={busy}
              className="flex h-7.5 items-center gap-1.5 rounded border border-pd-danger/40 bg-pd-danger/10 px-3 text-pd-xs font-bold text-pd-danger hover:bg-pd-danger/20 transition-colors"
            >
              <Square size={13} />
              Stop Tracking
            </button>
          ) : (
            <button
              onClick={() => startCamera(activeCam)}
              disabled={busy}
              className="flex h-7.5 items-center gap-1.5 rounded bg-pd-accent px-3 text-pd-xs font-bold text-pd-base hover:bg-pd-accent-hover transition-colors shadow"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
              Start Tracking Stream
            </button>
          )}
        </div>
      </div>

      {/* WORKSPACE: (Detected Drawer + Video Player + Sightings Review) */}
      <div className="flex flex-1 min-h-0 relative">
        {/* DETECTED PERSONS / LOCK-ON DRAWER (Left side) */}
        <div className="w-64 border-r border-pd-border bg-pd-surface p-3 flex flex-col justify-between overflow-y-auto">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between border-b border-pd-border/60 pb-1.5">
              <span className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">
                Detected Persons ({trackIds.length})
              </span>
              <span className="text-[10px] text-pd-accent font-mono">YOLOv8n</span>
            </div>

            {/* List of Detected Person Cards */}
            <div className="space-y-1.5">
              {trackIds.map((trackId) => {
                const isLocked = locked === trackId;
                const paddedId = String(trackId).padStart(2, "0");
                return (
                  <div
                    key={trackId}
                    onClick={() => lockOn(trackId)}
                    className={`flex items-center justify-between rounded p-2 border transition-all cursor-pointer ${
                      isLocked
                        ? "border-pd-success bg-pd-success/10 shadow-sm"
                        : "border-pd-border bg-pd-elevated hover:bg-pd-base"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded bg-pd-base border border-pd-border font-mono font-bold text-pd-xs text-pd-text-primary">
                        {paddedId}
                      </div>
                      <div>
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-pd-xs font-semibold text-pd-text-primary">
                            ID: {paddedId}
                          </span>
                          {isLocked && (
                            <span className="h-1.5 w-1.5 rounded-full bg-pd-success" />
                          )}
                        </div>
                        <div className="text-[10px] text-pd-text-tertiary">
                          {isLocked ? (
                            <span className="text-pd-success font-medium">Target Lock-On</span>
                          ) : (
                            <span>Pedestrian</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      {isLocked ? (
                        <div className="flex items-center gap-1 text-[9px] font-bold text-pd-success uppercase">
                          <Lock size={10} /> Locked
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[9px] text-pd-accent">
                          <Crosshair size={10} /> Lock
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {lock && (
              <div className="rounded border border-pd-border bg-pd-base/60 p-2 text-pd-xs font-mono space-y-1">
                <div className="text-pd-text-tertiary">
                  Lock: <span className="text-pd-success font-semibold">{lock.ledger_status}</span>
                </div>
                <div className="truncate text-[10px] text-pd-text-secondary" title={lock.tx_id}>
                  tx: {lock.tx_id || "—"}
                </div>
              </div>
            )}
          </div>

          {/* Action CTA at Drawer Bottom */}
          <button
            onClick={() => {
              if (locked !== null) {
                lockOn(locked);
              }
            }}
            className="mt-3 flex w-full h-8 items-center justify-center gap-1.5 rounded bg-pd-accent text-pd-xs font-bold text-pd-base hover:bg-pd-accent-hover transition-colors shadow"
          >
            <Crosshair size={14} />
            {locked !== null ? `Lock-On Target ${String(locked).padStart(2, "0")}` : "Select Target"}
          </button>
        </div>

        {/* CCTV VIDEO PLAYER AREA */}
        <div className="flex-1 flex flex-col bg-[#05080c] relative justify-between overflow-hidden">
          {/* Simulated or Live CCTV Surveillance Feed Canvas */}
          <div className="flex-1 relative flex items-center justify-center p-4">
            <div className="relative w-full max-w-4xl aspect-[16/9] bg-[#0d1117] rounded-sm border border-pd-border overflow-hidden shadow-2xl flex items-center justify-center">
              {/* Surveillance Video Simulation Texture */}
              <div className="absolute inset-0 bg-[radial-gradient(#1f2937_1px,transparent_1px)] [background-size:16px_16px] opacity-40" />

              {/* Timestamp & Feed Watermark */}
              <div className="absolute top-3 left-3 z-10 font-mono text-pd-xs text-pd-text-secondary bg-pd-base/80 px-2 py-1 rounded border border-pd-border/60">
                {activeCam.toUpperCase()} | {CAMERAS.find((c) => c.id === activeCam)?.label.split(":")[1] || "Live Feed"} | 2024-08-28 14:32:07 UTC
              </div>

              <div className="absolute top-3 right-3 z-10 font-mono text-pd-xs text-pd-danger bg-pd-danger/10 px-2 py-1 rounded border border-pd-danger/30 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-pd-danger animate-ping" />
                REC 00:02:15
              </div>

              {/* Live Stream or Simulated Canvas */}
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
                              stroke={active ? "#3fb950" : "#58a6ff"}
                              strokeWidth={active ? 3 : 2}
                            />
                            <text
                              x={b.x}
                              y={b.y - 4}
                              fontSize={14}
                              fill={active ? "#3fb950" : "#58a6ff"}
                              className="font-mono font-bold"
                            >
                              {String(b.track_id).padStart(2, "0")}
                              {active ? " (LOCKED)" : ""}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  )}
                </>
              ) : (
                /* Fallback Simulated Bounding Boxes */
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="absolute top-[35%] left-[25%] h-36 w-16 border border-pd-accent/60 bg-pd-accent/10 rounded-sm flex flex-col justify-between p-1">
                    <span className="font-mono text-[9px] bg-pd-accent/80 text-pd-base px-1 rounded font-bold self-start">
                      01 (90%)
                    </span>
                  </div>

                  <div className="absolute top-[40%] left-[42%] h-40 w-18 border border-pd-accent/60 bg-pd-accent/10 rounded-sm flex flex-col justify-between p-1">
                    <span className="font-mono text-[9px] bg-pd-accent/80 text-pd-base px-1 rounded font-bold self-start">
                      02 (95%)
                    </span>
                  </div>

                  <div className="absolute top-[30%] left-[60%] h-48 w-22 border-2 border-pd-success bg-pd-success/15 rounded-sm flex flex-col justify-between p-1 shadow-[0_0_15px_rgba(63,185,80,0.4)] animate-pulse">
                    <span className="font-mono text-[10px] bg-pd-success text-pd-base px-1.5 py-0.5 rounded font-bold self-start flex items-center gap-1">
                      TARGET: 03 (98%)
                    </span>
                    <span className="font-mono text-[9px] bg-pd-base/80 text-pd-success px-1 rounded self-center">
                      LOCK-ON ACTIVE
                    </span>
                  </div>

                  <div className="absolute top-[45%] left-[78%] h-32 w-14 border border-pd-accent/60 bg-pd-accent/10 rounded-sm flex flex-col justify-between p-1">
                    <span className="font-mono text-[9px] bg-pd-accent/80 text-pd-base px-1 rounded font-bold self-start">
                      04 (91%)
                    </span>
                  </div>
                </div>
              )}

              {error && (
                <div className="absolute bottom-3 left-3 right-3 rounded border border-pd-danger/40 bg-pd-danger/10 px-3 py-1.5 text-pd-xs text-pd-danger z-20">
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Video Player Bottom Controls Scrubber */}
          <div className="flex h-10 items-center justify-between border-t border-pd-border bg-pd-surface px-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="rounded p-1 text-pd-text-secondary hover:text-pd-text-primary"
              >
                {isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <span className="font-mono text-pd-xs text-pd-text-secondary">
                00:02:15 / 00:05:00
              </span>
            </div>

            {/* Scrubber */}
            <div className="flex-1 mx-4">
              <div className="h-1.5 w-full rounded bg-pd-elevated overflow-hidden relative cursor-pointer">
                <div className="h-full bg-pd-accent w-[45%]" />
              </div>
            </div>

            <div className="flex items-center gap-2 text-pd-xs text-pd-text-tertiary">
              <span className="font-mono">Speed: 1.0x</span>
              <span className="font-mono">FPS: 30</span>
            </div>
          </div>
        </div>

        {/* SIGHTINGS REVIEW PANEL (Phase 5, FR-2.3) */}
        <div className="flex w-64 flex-col border-l border-pd-border bg-pd-surface">
          <div className="flex h-9 items-center justify-between border-b border-pd-border px-3 text-pd-xs uppercase tracking-wide text-pd-text-tertiary">
            <div className="flex items-center gap-1.5 font-semibold">
              <Activity size={12} className="text-pd-accent" />
              Sightings ({sightings.length})
            </div>
            <span className="text-[10px] text-pd-accent font-mono">OSNet</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-2">
            {sightings.length === 0 ? (
              <div className="px-2 py-4 text-center text-pd-xs text-pd-text-tertiary">
                No downstream sightings yet. Lock onto a target to activate cross-camera handoff matching.
              </div>
            ) : (
              sightings.map((s, i) => {
                const rv = s.sighting_id != null ? reviews[s.sighting_id] : undefined;
                const frameName = s.frame_path?.split(/[\\/]/).pop();
                return (
                  <div
                    key={`${s.sighting_id ?? "x"}-${s.ts}-${i}`}
                    className="rounded border border-pd-border bg-pd-elevated p-2 text-pd-xs space-y-1.5"
                  >
                    <div className="flex items-center gap-2">
                      {frameName && (
                        <img
                          src={`${ENGINE}/cv/sightings/${frameName}`}
                          alt="sighting crop"
                          className="h-10 w-10 rounded border border-pd-border object-cover bg-black"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-mono font-semibold text-pd-text-primary">
                          {s.camera_code.toUpperCase()}
                        </div>
                        <div className="text-[11px] text-pd-text-secondary font-mono">
                          Sim: <span className="text-pd-success font-bold">{(s.similarity * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>

                    {rv ? (
                      <div className="rounded bg-pd-base/80 p-1.5 text-[10px] text-pd-text-tertiary font-mono">
                        <div className="font-semibold text-pd-text-primary">
                          {rv.action === "confirm" ? "✓ Confirmed (+10 edge)" : "✗ Rejected"}
                        </div>
                        <div className="truncate text-pd-text-secondary" title={rv.res.tx_id}>
                          tx: {rv.res.tx_id || "—"}
                        </div>
                      </div>
                    ) : s.sighting_id == null ? (
                      <div className="text-[10px] text-pd-text-tertiary">
                        Simulated sighting (DB offline)
                      </div>
                    ) : (
                      <div className="flex gap-1.5 pt-1">
                        <button
                          onClick={() => review(s.sighting_id!, "confirm")}
                          disabled={busy}
                          className="flex flex-1 items-center justify-center gap-1 rounded border border-pd-success/40 bg-pd-success/10 py-1 text-pd-xs font-semibold text-pd-success hover:bg-pd-success/20 disabled:opacity-50 transition-colors"
                        >
                          <Check size={12} /> Confirm
                        </button>
                        <button
                          onClick={() => review(s.sighting_id!, "reject")}
                          disabled={busy}
                          className="flex flex-1 items-center justify-center gap-1 rounded border border-pd-danger/40 bg-pd-danger/10 py-1 text-pd-xs font-semibold text-pd-danger hover:bg-pd-danger/20 disabled:opacity-50 transition-colors"
                        >
                          <X size={12} /> Reject
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

      {/* BOTTOM CAMERA TOPOLOGY & HANDOFF STRIP */}
      <div className="h-14 border-t border-pd-border bg-pd-surface px-4 flex items-center justify-between select-none">
        <div className="flex items-center gap-2">
          <span className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">
            Multi-Cam Topology:
          </span>
          <div className="flex items-center gap-2 text-pd-xs">
            {/* CAM-01 */}
            <div className="flex items-center gap-1.5 rounded bg-pd-success/15 border border-pd-success/30 px-2.5 py-1 text-pd-success font-mono font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-pd-success" />
              CAM-01 (Active)
            </div>

            <span className="text-pd-accent font-mono text-[11px]">⟶ est. 3m travel ⟶</span>

            {/* CAM-02 */}
            <div className="flex items-center gap-1.5 rounded bg-pd-accent/15 border border-pd-accent/30 px-2.5 py-1 text-pd-accent font-mono font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-pd-accent animate-pulse" />
              CAM-02 (Armed for Handoff)
            </div>

            <span className="text-pd-text-tertiary font-mono text-[11px]">⟶</span>

            {/* CAM-03 */}
            <div className="flex items-center gap-1.5 rounded bg-pd-elevated border border-pd-border px-2 py-1 text-pd-text-tertiary font-mono">
              CAM-03 (Standby)
            </div>

            {/* CAM-04 */}
            <div className="flex items-center gap-1.5 rounded bg-pd-elevated border border-pd-border px-2 py-1 text-pd-text-tertiary font-mono">
              CAM-04 (Standby)
            </div>
          </div>
        </div>

        <div className="font-mono text-pd-xs text-pd-text-tertiary">
          Re-ID OSNet Confidence: <span className="text-pd-success font-bold">92.4% Match</span>
        </div>
      </div>
    </div>
  );
}
