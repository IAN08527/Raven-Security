import { CSSProperties, useCallback, useMemo, useState } from "react";
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

// ── RAVEN-refactor theme tokens (match RavenShell) ──
const AC = "#e8c15a";
const hexA = (h: string, a: number) => h + Math.round(a * 255).toString(16).padStart(2, "0");
const acBorder = hexA(AC, 0.35);
const GREEN = "#5ecf9a";
const RED = "#ff5a3c";
const MONO = "'Spline Sans Mono',monospace";
const mono = (extra?: CSSProperties): CSSProperties => ({ fontFamily: MONO, ...extra });

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
const CONF: Record<number, number> = { 1: 90, 2: 95, 3: 98, 4: 91, 5: 88 };

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

  const camLabel = CAMERAS.find((c) => c.id === activeCam)?.label.split(":")[1]?.trim() || "Live Feed";
  const bracket = (pos: CSSProperties): CSSProperties => ({ position: "absolute", width: 18, height: 18, opacity: 0.7, ...pos });

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        flexDirection: "column",
        overflow: "hidden",
        userSelect: "none",
        background: "#060809",
        color: "#e8edf2",
        fontFamily: "'Instrument Sans',system-ui,sans-serif",
        fontSize: 13,
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: "@keyframes rvsPulse{0%,100%{opacity:1}50%{opacity:.25}}@keyframes rvsPing{0%{transform:scale(1);opacity:.7}80%,100%{transform:scale(2.4);opacity:0}}" }} />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* LEFT: DETECTED PERSONS / LOCK-ON */}
        <div style={{ width: 250, borderRight: "1px solid #1b212b", background: "#080b0e", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #1b212b", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773" })}>DETECTED · {trackIds.length}</span>
            <span style={mono({ fontSize: 9, color: AC })}>YOLOv8n</span>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 7 }}>
            {trackIds.map((trackId) => {
              const isLocked = locked === trackId;
              const paddedId = String(trackId).padStart(2, "0");
              return (
                <button
                  key={trackId}
                  onClick={() => lockOn(trackId)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    padding: "10px 11px",
                    background: isLocked ? "rgba(255,90,60,.07)" : "#0b0e12",
                    border: `1px solid ${isLocked ? "rgba(255,90,60,.4)" : "#12161d"}`,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "left",
                  }}
                >
                  <span style={mono({ fontSize: 15, fontWeight: 700, color: isLocked ? RED : "#5c6773" })}>{paddedId}</span>
                  <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
                    <span style={mono({ fontSize: 9, letterSpacing: ".1em", color: isLocked ? RED : "#98a4b3" })}>
                      {isLocked ? "TARGET LOCK-ON" : "PEDESTRIAN"}
                    </span>
                    <span style={mono({ fontSize: 9, color: "#5c6773" })}>CONF {CONF[trackId] ?? 90}%</span>
                  </span>
                  {isLocked ? <Lock size={12} color={RED} /> : <Crosshair size={12} color="#5c6773" />}
                </button>
              );
            })}

            {lock && (
              <div style={{ border: "1px solid #1b212b", background: "#0b0e12", padding: 9, ...mono({ fontSize: 9 }), display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ color: "#5c6773" }}>
                  LOCK: <span style={{ color: GREEN, fontWeight: 700 }}>{lock.ledger_status}</span>
                </div>
                <div style={{ color: "#98a4b3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={lock.tx_id}>
                  tx: {lock.tx_id || "—"}
                </div>
              </div>
            )}
          </div>

          <div style={{ padding: 12 }}>
            <button
              onClick={() => locked !== null && lockOn(locked)}
              style={mono({
                width: "100%",
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                background: hexA(AC, 0.1),
                border: `1px solid ${acBorder}`,
                color: AC,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: ".12em",
                cursor: "pointer",
              })}
            >
              <Crosshair size={13} />
              {locked !== null ? `LOCK-ON TARGET ${String(locked).padStart(2, "0")}` : "SELECT TARGET"}
            </button>
          </div>
        </div>

        {/* CENTER: VIDEO */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#040506", minWidth: 0 }}>
          {/* top control bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 18px", borderBottom: "1px solid #1b212b", background: "#07090c" }}>
            <select
              value={activeCam}
              onChange={(e) => {
                const newCam = e.target.value;
                setActiveCam(newCam);
                if (session) startCamera(newCam);
              }}
              style={mono({ height: 28, background: "#0b0e12", border: "1px solid #1b212b", color: AC, padding: "0 10px", fontSize: 10, letterSpacing: ".06em", outline: "none", cursor: "pointer" })}
            >
              {CAMERAS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            <span style={mono({ display: "flex", alignItems: "center", gap: 6, fontSize: 9, letterSpacing: ".1em", color: GREEN, whiteSpace: "nowrap", flexShrink: 0 })}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: GREEN, animation: "rvsPulse 2s infinite" }} />LIVE 1080p 30fps
            </span>
            <span style={mono({ fontSize: 9, letterSpacing: ".08em", color: "#5c6773", whiteSpace: "nowrap", flexShrink: 0 })}>YOLOv8 + OSNet RE-ID</span>
            <span style={mono({ display: "flex", alignItems: "center", gap: 6, fontSize: 9, color: connected ? GREEN : "#5c6773", whiteSpace: "nowrap" })}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: connected ? GREEN : "#5c6773" }} />
              {connected ? "EVENTS LIVE" : "EVENTS STANDBY"}
            </span>
            {session ? (
              <button onClick={stop} disabled={busy}
                style={mono({ marginLeft: "auto", height: 30, display: "flex", alignItems: "center", gap: 8, padding: "0 14px", background: "rgba(255,90,60,.1)", border: "1px solid rgba(255,90,60,.4)", color: RED, fontSize: 10, fontWeight: 600, letterSpacing: ".1em", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 })}>
                <Square size={13} /> STOP TRACKING
              </button>
            ) : (
              <button onClick={() => startCamera(activeCam)} disabled={busy}
                style={mono({ marginLeft: "auto", height: 30, display: "flex", alignItems: "center", gap: 8, padding: "0 14px", background: hexA(AC, 0.1), border: `1px solid ${acBorder}`, color: AC, fontSize: 10, fontWeight: 600, letterSpacing: ".1em", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 })}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} START TRACKING
              </button>
            )}
          </div>

          {/* video canvas */}
          <div style={{ flex: 1, position: "relative", margin: 16, border: "1px solid #1b212b", overflow: "hidden", background: "#07090c" }}>
            <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(#12161d 1px,transparent 1px)", backgroundSize: "18px 18px", opacity: 0.6 }} />
            <span style={bracket({ top: 10, left: 10, borderTop: `1px solid ${AC}`, borderLeft: `1px solid ${AC}` })} />
            <span style={bracket({ top: 10, right: 10, borderTop: `1px solid ${AC}`, borderRight: `1px solid ${AC}` })} />
            <span style={bracket({ bottom: 10, left: 10, borderBottom: `1px solid ${AC}`, borderLeft: `1px solid ${AC}` })} />
            <span style={bracket({ bottom: 10, right: 10, borderBottom: `1px solid ${AC}`, borderRight: `1px solid ${AC}` })} />

            <div style={{ position: "absolute", top: 16, left: 38, right: 170, ...mono({ fontSize: 10 }), letterSpacing: ".06em", color: "#98a4b3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {activeCam.toUpperCase()} · {camLabel} · 2024-08-28 14:32:07 UTC
            </div>
            <div style={{ position: "absolute", top: 16, right: 38, display: "flex", alignItems: "center", gap: 7, ...mono({ fontSize: 10 }), letterSpacing: ".1em", color: RED }}>
              <span style={{ position: "relative", display: "flex", width: 7, height: 7 }}>
                <span style={{ position: "absolute", width: 7, height: 7, borderRadius: "50%", background: RED, animation: "rvsPing 1.4s infinite" }} />
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: RED }} />
              </span>
              REC 00:02:15
            </div>

            {session ? (
              <>
                <img src={`${ENGINE}${session.stream_url}`} style={{ height: "100%", width: "100%", objectFit: "contain" }} alt={`feed ${activeCam}`} />
                {frame && (
                  <svg viewBox={`0 0 ${frame.w} ${frame.h}`} preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, height: "100%", width: "100%" }}>
                    {boxes.map((b) => {
                      const active = b.track_id === locked;
                      return (
                        <g key={b.track_id} style={{ cursor: "pointer" }} onClick={() => lockOn(b.track_id)}>
                          <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke={active ? RED : AC} strokeWidth={active ? 3 : 2} />
                          <text x={b.x} y={b.y - 4} fontSize={14} fill={active ? RED : AC} fontFamily={MONO} fontWeight={700}>
                            {String(b.track_id).padStart(2, "0")}{active ? " (LOCKED)" : ""}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                )}
              </>
            ) : (
              /* Fallback simulated bounding boxes */
              <>
                <div style={{ position: "absolute", top: "34%", left: "24%", height: "31%", width: "7%", border: `1px solid ${hexA(AC, 0.55)}` }}>
                  <span style={{ position: "absolute", top: -17, left: -1, ...mono({ fontSize: 9 }), color: AC, letterSpacing: ".06em" }}>01·90</span>
                </div>
                <div style={{ position: "absolute", top: "39%", left: "41%", height: "34%", width: "8%", border: `1px solid ${hexA(AC, 0.55)}` }}>
                  <span style={{ position: "absolute", top: -17, left: -1, ...mono({ fontSize: 9 }), color: AC, letterSpacing: ".06em" }}>02·95</span>
                </div>
                <div style={{ position: "absolute", top: "28%", left: "59%", height: "42%", width: "10%", border: `1.5px solid ${RED}`, boxShadow: "0 0 22px rgba(255,90,60,.35)", animation: "rvsPulse 2.6s infinite" }}>
                  <span style={{ position: "absolute", top: -19, left: -2, ...mono({ fontSize: 10, fontWeight: 700 }), color: "#060809", background: RED, padding: "1px 6px", letterSpacing: ".06em" }}>TARGET 03·98</span>
                  <span style={{ position: "absolute", bottom: -17, left: 0, right: 0, textAlign: "center", ...mono({ fontSize: 8 }), letterSpacing: ".14em", color: RED, whiteSpace: "nowrap" }}>LOCKED</span>
                </div>
                <div style={{ position: "absolute", top: "44%", left: "77%", height: "27%", width: "6%", border: `1px solid ${hexA(AC, 0.55)}` }}>
                  <span style={{ position: "absolute", top: -17, left: -1, ...mono({ fontSize: 9 }), color: AC, letterSpacing: ".06em" }}>04·91</span>
                </div>
              </>
            )}

            {error && (
              <div style={{ position: "absolute", bottom: 12, left: 12, right: 12, border: "1px solid rgba(255,90,60,.4)", background: "rgba(255,90,60,.1)", padding: "6px 12px", ...mono({ fontSize: 10 }), color: RED }}>
                {error}
              </div>
            )}
          </div>

          {/* transport bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "0 18px 14px", ...mono({ fontSize: 10 }), color: "#5c6773" }}>
            <button onClick={() => setIsPlaying(!isPlaying)} style={{ background: "none", border: "none", color: "#98a4b3", cursor: "pointer", display: "flex" }}>
              {isPlaying ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <span>00:02:15 / 00:05:00</span>
            <div style={{ flex: 1, height: 3, background: "#12161d", position: "relative" }}>
              <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "45%", background: AC }} />
              <div style={{ position: "absolute", left: "45%", top: -3, width: 1, height: 9, background: AC }} />
            </div>
            <span>1.0× · 30FPS</span>
          </div>
        </div>

        {/* RIGHT: SIGHTINGS REVIEW */}
        <div style={{ width: 250, borderLeft: "1px solid #1b212b", background: "#080b0e", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #1b212b", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={mono({ display: "flex", alignItems: "center", gap: 6, fontSize: 9, letterSpacing: ".16em", color: "#5c6773" })}>
              <Activity size={11} color={AC} /> SIGHTINGS · {sightings.length}
            </span>
            <span style={mono({ fontSize: 9, color: AC })}>OSNet</span>
          </div>

          <div style={{ minHeight: 0, flex: 1, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {sightings.length === 0 ? (
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
                <span style={mono({ fontSize: 10, lineHeight: 1.7, color: "#5c6773", textAlign: "center", letterSpacing: ".04em" })}>
                  NO DOWNSTREAM SIGHTINGS<br />
                  <span style={{ color: "#3d4653" }}>lock a target to arm<br />cross-camera handoff</span>
                </span>
              </div>
            ) : (
              sightings.map((s, i) => {
                const rv = s.sighting_id != null ? reviews[s.sighting_id] : undefined;
                const frameName = s.frame_path?.split(/[\\/]/).pop();
                return (
                  <div key={`${s.sighting_id ?? "x"}-${s.ts}-${i}`} style={{ border: "1px solid #1b212b", background: "#0b0e12", padding: 9, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {frameName && (
                        <img src={`${ENGINE}/cv/sightings/${frameName}`} alt="sighting crop" style={{ height: 40, width: 40, border: "1px solid #1b212b", objectFit: "cover", background: "#000" }} />
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={mono({ fontWeight: 600, color: "#e8edf2", fontSize: 11 })}>{s.camera_code.toUpperCase()}</div>
                        <div style={mono({ fontSize: 10, color: "#98a4b3" })}>
                          SIM: <span style={{ color: GREEN, fontWeight: 700 }}>{(s.similarity * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>

                    {rv ? (
                      <div style={{ background: "#060809", padding: 6, ...mono({ fontSize: 10 }), color: "#5c6773" }}>
                        <div style={{ fontWeight: 700, color: rv.action === "confirm" ? GREEN : RED }}>
                          {rv.action === "confirm" ? "✓ CONFIRMED (+10 edge)" : "✗ REJECTED"}
                        </div>
                        <div style={{ color: "#98a4b3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={rv.res.tx_id}>tx: {rv.res.tx_id || "—"}</div>
                      </div>
                    ) : s.sighting_id == null ? (
                      <div style={mono({ fontSize: 9, color: "#5c6773" })}>Simulated sighting (DB offline)</div>
                    ) : (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => review(s.sighting_id!, "confirm")} disabled={busy}
                          style={mono({ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, border: "1px solid rgba(94,207,154,.4)", background: "rgba(94,207,154,.1)", padding: "5px 0", fontSize: 10, fontWeight: 600, color: GREEN, cursor: "pointer" })}>
                          <Check size={12} /> CONFIRM
                        </button>
                        <button onClick={() => review(s.sighting_id!, "reject")} disabled={busy}
                          style={mono({ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, border: "1px solid rgba(255,90,60,.4)", background: "rgba(255,90,60,.1)", padding: "5px 0", fontSize: 10, fontWeight: 600, color: RED, cursor: "pointer" })}>
                          <X size={12} /> REJECT
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div style={{ padding: "14px 16px", borderTop: "1px solid #1b212b", ...mono({ fontSize: 9 }), letterSpacing: ".08em", color: "#5c6773" }}>
            RE-ID CONF <span style={{ color: GREEN, fontWeight: 700 }}>92.4%</span>
          </div>
        </div>
      </div>

      {/* BOTTOM: CAMERA TOPOLOGY */}
      <div style={{ height: 52, borderTop: "1px solid #1b212b", background: "#07090c", display: "flex", alignItems: "center", padding: "0 18px", flexShrink: 0 }}>
        <span style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773", marginRight: 18 })}>TOPOLOGY</span>
        <div style={{ display: "flex", alignItems: "center", flex: 1, ...mono({ fontSize: 10 }), letterSpacing: ".06em" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 7, color: GREEN, border: "1px solid rgba(94,207,154,.35)", background: "rgba(94,207,154,.08)", padding: "5px 12px" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: GREEN }} />CAM-01 ACTIVE
          </span>
          <span style={{ flex: "0 0 70px", height: 1, background: `linear-gradient(90deg,${GREEN},${AC})`, position: "relative" }}>
            <span style={{ position: "absolute", top: -14, left: "50%", transform: "translateX(-50%)", fontSize: 8, color: "#5c6773", letterSpacing: ".08em", whiteSpace: "nowrap" }}>3M EST</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 7, color: AC, border: `1px solid ${acBorder}`, background: hexA(AC, 0.1), padding: "5px 12px" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: AC, animation: "rvsPulse 1.8s infinite" }} />CAM-02 ARMED
          </span>
          <span style={{ flex: "0 0 46px", height: 1, background: "#232b37" }} />
          <span style={{ color: "#5c6773", border: "1px solid #1b212b", padding: "5px 12px" }}>CAM-03 STANDBY</span>
          <span style={{ flex: "0 0 46px", height: 1, background: "#232b37" }} />
          <span style={{ color: "#5c6773", border: "1px solid #1b212b", padding: "5px 12px" }}>CAM-04 STANDBY</span>
        </div>
        <span style={mono({ fontSize: 9, letterSpacing: ".08em", color: "#5c6773" })}>
          RE-ID OSNet <span style={{ color: GREEN, fontWeight: 700 }}>92.4% MATCH</span>
        </span>
      </div>
    </div>
  );
}
