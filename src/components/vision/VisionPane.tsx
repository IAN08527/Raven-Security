import { useState } from "react";
import { useCaseStore } from "../../store/case";

interface DetectedPerson {
  id: string;
  label: string;
  confidence: number;
  status: "Target Lock-On" | "Pedestrian";
  box: { top: number; left: number; width: number; height: number };
}

const DETECTED_PERSONS: DetectedPerson[] = [
  {
    id: "01",
    label: "Pedestrian",
    confidence: 90,
    status: "Pedestrian",
    box: { top: 38, left: 49, width: 6, height: 18 },
  },
  {
    id: "02",
    label: "Pedestrian",
    confidence: 95,
    status: "Pedestrian",
    box: { top: 44, left: 60, width: 7, height: 22 },
  },
  {
    id: "03",
    label: "Target Lock-On",
    confidence: 98,
    status: "Target Lock-On",
    box: { top: 41, left: 72, width: 8, height: 26 },
  },
  {
    id: "04",
    label: "Pedestrian",
    confidence: 91,
    status: "Pedestrian",
    box: { top: 48, left: 84, width: 6, height: 16 },
  },
  {
    id: "05",
    label: "Pedestrian",
    confidence: 88,
    status: "Pedestrian",
    box: { top: 50, left: 90, width: 6, height: 15 },
  },
];

export function VisionPane() {
  const cctvState = useCaseStore((s) => s.cctvState);
  const triggerDetectAll = useCaseStore((s) => s.triggerDetectAll);
  const lockCctvTarget = useCaseStore((s) => s.lockCctvTarget);
  const startMultiCamTracking = useCaseStore((s) => s.startMultiCamTracking);
  const setActiveCam = useCaseStore((s) => s.setActiveCam);

  const [isPlaying, setIsPlaying] = useState(true);
  const [selectedPersonId, setSelectedPersonId] = useState<string>("03");

  return (
    <div className="flex h-full flex-col bg-pd-base text-pd-text-primary overflow-hidden select-none">
      {/* TOP CONTROLS BAR */}
      <div className="flex items-center justify-between border-b border-pd-border bg-pd-surface px-4 py-2">
        <div className="flex items-center gap-3">
          {/* Camera Selector Dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-pd-xs text-pd-text-tertiary">Feed:</span>
            <select
              value={cctvState.activeCam}
              onChange={(e) => setActiveCam(e.target.value)}
              className="h-7 rounded border border-pd-border bg-pd-elevated px-2 text-pd-xs font-mono text-pd-text-primary focus:border-pd-accent focus:outline-none"
            >
              <option value="CAM-01">CAM-01: Main Gate - East Wing</option>
              <option value="CAM-02">CAM-02: North Crossing - Cam B</option>
              <option value="CAM-03">CAM-03: South Highway Tollgate</option>
              <option value="CAM-04">CAM-04: Metro Station Exit 2</option>
            </select>
          </div>

          <span className="flex items-center gap-1 rounded bg-pd-success/15 border border-pd-success/30 px-2 py-0.5 text-[10px] font-mono font-semibold text-pd-success">
            <span className="h-1.5 w-1.5 rounded-full bg-pd-success animate-pulse" />
            LIVE 1080p 30fps
          </span>

          <span className="font-mono text-pd-xs text-pd-text-tertiary">
            YOLOv8 + OSNet Re-ID Active
          </span>
        </div>

        {/* Action Button: Detect All Persons in Footage */}
        <button
          onClick={triggerDetectAll}
          className="flex h-7.5 items-center gap-2 rounded bg-pd-accent px-3 text-pd-xs font-bold text-pd-base hover:bg-pd-accent-hover transition-colors shadow"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          Detect All Persons in Footage
        </button>
      </div>

      {/* WORKSPACE: (Detected Drawer + Video Player) */}
      <div className="flex flex-1 min-h-0 relative">
        {/* DETECTED PERSONS DRAWER (Left side of video) */}
        <div className="w-64 border-r border-pd-border bg-pd-surface p-3 flex flex-col justify-between overflow-y-auto">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between border-b border-pd-border/60 pb-1.5">
              <span className="text-pd-xs font-semibold uppercase tracking-wider text-pd-text-tertiary">
                Detected Persons ({DETECTED_PERSONS.length})
              </span>
              <span className="text-[10px] text-pd-accent font-mono">YOLOv8n</span>
            </div>

            {/* List of Detected Person Cards */}
            <div className="space-y-1.5">
              {DETECTED_PERSONS.map((person) => {
                const isLocked = selectedPersonId === person.id;
                return (
                  <div
                    key={person.id}
                    onClick={() => {
                      setSelectedPersonId(person.id);
                      lockCctvTarget(person.id);
                    }}
                    className={`flex items-center justify-between rounded p-2 border transition-all cursor-pointer ${
                      isLocked
                        ? "border-pd-success bg-pd-success/10 shadow-sm"
                        : "border-pd-border bg-pd-elevated hover:bg-pd-base"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded bg-pd-base border border-pd-border font-mono font-bold text-pd-xs text-pd-text-primary">
                        {person.id}
                      </div>
                      <div>
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-pd-xs font-semibold text-pd-text-primary">
                            ID: {person.id}
                          </span>
                          {isLocked && (
                            <span className="h-1.5 w-1.5 rounded-full bg-pd-success" />
                          )}
                        </div>
                        <div className="text-[10px] text-pd-text-tertiary">
                          {isLocked ? (
                            <span className="text-pd-success font-medium">Target Lock-On</span>
                          ) : (
                            <span>{person.label}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="font-mono text-[10px] text-pd-text-tertiary">
                        {person.confidence}%
                      </span>
                      {isLocked ? (
                        <div className="text-[9px] font-bold text-pd-success uppercase">
                          Confirmed
                        </div>
                      ) : (
                        <div className="text-[9px] text-pd-accent">Select</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action CTA at Drawer Bottom */}
          <button
            onClick={startMultiCamTracking}
            className="mt-3 flex w-full h-8 items-center justify-center gap-1.5 rounded bg-pd-accent text-pd-xs font-bold text-pd-base hover:bg-pd-accent-hover transition-colors shadow"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
            Start Multi-Cam Tracking
          </button>
        </div>

        {/* CCTV VIDEO PLAYER AREA */}
        <div className="flex-1 flex flex-col bg-[#05080c] relative justify-between overflow-hidden">
          {/* Simulated CCTV Surveillance Feed Canvas */}
          <div className="flex-1 relative flex items-center justify-center p-4">
            <div className="relative w-full max-w-4xl aspect-[16/9] bg-[#0d1117] rounded-sm border border-pd-border overflow-hidden shadow-2xl flex items-center justify-center">
              {/* Surveillance Video Simulation Texture */}
              <div className="absolute inset-0 bg-[radial-gradient(#1f2937_1px,transparent_1px)] [background-size:16px_16px] opacity-40" />

              {/* Timestamp & Feed Watermark */}
              <div className="absolute top-3 left-3 z-10 font-mono text-pd-xs text-pd-text-secondary bg-pd-base/80 px-2 py-1 rounded border border-pd-border/60">
                {cctvState.activeCam} | Main Gate | 2024-08-28 14:32:07 UTC
              </div>

              <div className="absolute top-3 right-3 z-10 font-mono text-pd-xs text-pd-danger bg-pd-danger/10 px-2 py-1 rounded border border-pd-danger/30 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-pd-danger animate-ping" />
                REC 00:02:15
              </div>

              {/* Person Simulation Figures & YOLO Bounding Boxes */}
              <div className="absolute inset-0 flex items-center justify-center">
                {/* Person 01 */}
                <div className="absolute top-[35%] left-[25%] h-36 w-16 border border-pd-accent/60 bg-pd-accent/10 rounded-sm flex flex-col justify-between p-1">
                  <span className="font-mono text-[9px] bg-pd-accent/80 text-pd-base px-1 rounded font-bold self-start">
                    01 (90%)
                  </span>
                </div>

                {/* Person 02 */}
                <div className="absolute top-[40%] left-[42%] h-40 w-18 border border-pd-accent/60 bg-pd-accent/10 rounded-sm flex flex-col justify-between p-1">
                  <span className="font-mono text-[9px] bg-pd-accent/80 text-pd-base px-1 rounded font-bold self-start">
                    02 (95%)
                  </span>
                </div>

                {/* Person 03 (LOCKED TARGET) */}
                <div className="absolute top-[30%] left-[60%] h-48 w-22 border-2 border-pd-success bg-pd-success/15 rounded-sm flex flex-col justify-between p-1 shadow-[0_0_15px_rgba(63,185,80,0.4)] animate-pulse">
                  <span className="font-mono text-[10px] bg-pd-success text-pd-base px-1.5 py-0.5 rounded font-bold self-start flex items-center gap-1">
                    TARGET: 03 (98%)
                  </span>
                  <span className="font-mono text-[9px] bg-pd-base/80 text-pd-success px-1 rounded self-center">
                    LOCK-ON ACTIVE
                  </span>
                </div>

                {/* Person 04 */}
                <div className="absolute top-[45%] left-[78%] h-32 w-14 border border-pd-accent/60 bg-pd-accent/10 rounded-sm flex flex-col justify-between p-1">
                  <span className="font-mono text-[9px] bg-pd-accent/80 text-pd-base px-1 rounded font-bold self-start">
                    04 (91%)
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Video Player Bottom Controls Scrubber */}
          <div className="flex h-10 items-center justify-between border-t border-pd-border bg-pd-surface px-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="rounded p-1 text-pd-text-secondary hover:text-pd-text-primary"
              >
                {isPlaying ? "⏸" : "▶"}
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
