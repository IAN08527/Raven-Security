import { useState } from "react";

interface RoutineMapPaneProps {
  entityName?: string;
}

interface PingPoint {
  id: string;
  time: string;
  location: string;
  duration: string;
  tower: string;
  type: "home" | "work" | "associate" | "transit";
  x: number;
  y: number;
}

const DEMO_PINGS: PingPoint[] = [
  { id: "p1", time: "08-15 14:32", location: "Dharavi Cross Lane", duration: "12min", tower: "MH-MUM-0847", type: "home", x: 345, y: 520 },
  { id: "p2", time: "08-15 13:15", location: "MH-MUM-0211", duration: "45m", tower: "MH-MUM-0211", type: "work", x: 500, y: 210 },
  { id: "p3", time: "08-15 09:05", location: "MH-MUM-0211", duration: "3h", tower: "MH-MUM-0211", type: "work", x: 515, y: 225 },
  { id: "p4", time: "08-15 08:30", location: "TRANSIT (WEH)", duration: "35m", tower: "MH-MUM-0441", type: "transit", x: 420, y: 360 },
  { id: "p5", time: "08-15 01:10", location: "MH-MUM-0847", duration: "7h", tower: "MH-MUM-0847", type: "home", x: 355, y: 535 },
  { id: "p6", time: "08-14 23:45", location: "MH-MUM-0847", duration: "1h", tower: "MH-MUM-0847", type: "home", x: 335, y: 510 },
  { id: "p7", time: "08-14 20:15", location: "Bandra Terminus", duration: "50m", tower: "MH-MUM-0512", type: "associate", x: 650, y: 320 },
];

export function RoutineMapPane({ entityName = "Rakesh Sawant" }: RoutineMapPaneProps) {
  const [dateRange, setDateRange] = useState("2024-08-01 — 2024-08-30");
  const [showPings, setShowPings] = useState(true);
  const [showLoop, setShowLoop] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [showAssociates, setShowAssociates] = useState(true);
  const [selectedPoint, setSelectedPoint] = useState<PingPoint | null>(DEMO_PINGS[0]);
  const [zoom, setZoom] = useState(1);

  return (
    <div className="flex h-full w-full bg-[#070b10] text-pd-text-primary overflow-hidden relative select-none">
      {/* CENTRAL FULL-CANVAS MAP AREA */}
      <div className="flex-1 h-full relative overflow-hidden flex items-center justify-center">
        {/* SVG Interactive Map Vector Simulation */}
        <div
          className="w-full h-full relative flex items-center justify-center transition-transform duration-200"
          style={{ transform: `scale(${zoom})` }}
        >
          <svg className="w-full h-full" viewBox="0 0 1000 700">
            <defs>
              {/* Radial gradient for Hotspot zones */}
              <radialGradient id="hotspot-glow-home" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#58a6ff" stopOpacity="0.45" />
                <stop offset="60%" stopColor="#58a6ff" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#58a6ff" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="hotspot-glow-work" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#3fb950" stopOpacity="0.45" />
                <stop offset="60%" stopColor="#3fb950" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#3fb950" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="hotspot-glow-assoc" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#d29922" stopOpacity="0.45" />
                <stop offset="60%" stopColor="#d29922" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#d29922" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* Map Grid Texture Lines */}
            <g stroke="#1e293b" strokeWidth="0.5" opacity="0.4">
              {Array.from({ length: 20 }).map((_, i) => (
                <line key={`h-${i}`} x1="0" y1={i * 50} x2="1000" y2={i * 50} />
              ))}
              {Array.from({ length: 25 }).map((_, i) => (
                <line key={`v-${i}`} x1={i * 50} y1="0" x2={i * 50} y2="700" />
              ))}
            </g>

            {/* Coastline / Highway Arteries */}
            <path
              d="M 150,0 Q 220,250 280,450 T 400,700"
              fill="none"
              stroke="#0f172a"
              strokeWidth="40"
              opacity="0.8"
            />
            <path
              d="M 300,700 C 350,500 480,300 520,0"
              fill="none"
              stroke="#1e293b"
              strokeWidth="4"
              opacity="0.6"
            />
            <path
              d="M 280,480 C 450,420 620,340 750,300"
              fill="none"
              stroke="#1e293b"
              strokeWidth="3"
              opacity="0.6"
            />

            {/* HOTSPOT CLUSTER ZONES (20% Opacity) */}
            {showHotspots && (
              <g>
                {/* Dharavi (Home Base) Hotspot */}
                <circle cx="345" cy="520" r="75" fill="url(#hotspot-glow-home)" stroke="#58a6ff" strokeWidth="1" strokeDasharray="3,3" opacity="0.8" />
                <text x="345" y="435" textAnchor="middle" fill="#79c0ff" fontSize="12" fontFamily="Inter" fontWeight="600">
                  Dharavi (Home Base)
                </text>

                {/* Andheri (Work / Safehouse) Hotspot */}
                <circle cx="505" cy="210" r="65" fill="url(#hotspot-glow-work)" stroke="#3fb950" strokeWidth="1" strokeDasharray="3,3" opacity="0.8" />
                <text x="505" y="135" textAnchor="middle" fill="#56d364" fontSize="12" fontFamily="Inter" fontWeight="600">
                  Andheri (Work / Safehouse)
                </text>

                {/* Bandra Terminus Hotspot */}
                <circle cx="650" cy="320" r="55" fill="url(#hotspot-glow-assoc)" stroke="#d29922" strokeWidth="1" strokeDasharray="3,3" opacity="0.8" />
                <text x="650" y="255" textAnchor="middle" fill="#e3b341" fontSize="12" fontFamily="Inter" fontWeight="600">
                  Bandra Station
                </text>
              </g>
            )}

            {/* ROUTINE PATH POLYLINE (Glowing blue curve) */}
            {showLoop && (
              <g>
                <path
                  d="M 345,520 C 420,380 480,260 505,210 C 530,160 620,240 650,320 C 670,390 450,540 345,520"
                  fill="none"
                  stroke="#58a6ff"
                  strokeWidth="2.5"
                  strokeDasharray="5,4"
                  opacity="0.85"
                />
              </g>
            )}

            {/* CDR PING POINTS */}
            {showPings &&
              DEMO_PINGS.map((ping) => {
                const isSelected = selectedPoint?.id === ping.id;
                return (
                  <g
                    key={ping.id}
                    onClick={() => setSelectedPoint(ping)}
                    className="cursor-pointer group"
                  >
                    {/* Outer glow ring on select */}
                    {isSelected && (
                      <circle
                        cx={ping.x}
                        cy={ping.y}
                        r="14"
                        fill="none"
                        stroke="#58a6ff"
                        strokeWidth="2"
                        className="animate-pulse"
                      />
                    )}
                    <circle
                      cx={ping.x}
                      cy={ping.y}
                      r={isSelected ? 6 : 4.5}
                      fill={
                        ping.type === "home"
                          ? "#3fb950"
                          : ping.type === "work"
                          ? "#58a6ff"
                          : ping.type === "associate"
                          ? "#d29922"
                          : "#8b949e"
                      }
                      stroke="#0d1117"
                      strokeWidth="1.5"
                    />
                  </g>
                );
              })}

            {/* SELECTED POINT TOOLTIP POPUP */}
            {selectedPoint && (
              <g transform={`translate(${selectedPoint.x + 15}, ${selectedPoint.y - 45})`}>
                <rect
                  width="220"
                  height="70"
                  rx="4"
                  fill="#161b22"
                  stroke="#30363d"
                  strokeWidth="1"
                  filter="drop-shadow(0 4px 12px rgba(0,0,0,0.6))"
                />
                <text x="12" y="18" fill="#8b949e" fontSize="10" fontFamily="Inter" fontWeight="700" className="uppercase">
                  SELECTED CDR POINT
                </text>

                <text x="12" y="34" fill="#c9d1d9" fontSize="11" fontFamily="JetBrains Mono" fontWeight="600">
                  CDR Ping: <tspan fill="#58a6ff">{selectedPoint.time} UTC</tspan>
                </text>
                <text x="12" y="48" fill="#8b949e" fontSize="10" fontFamily="JetBrains Mono">
                  Tower: {selectedPoint.tower}
                </text>
                <text x="12" y="60" fill="#8b949e" fontSize="10" fontFamily="JetBrains Mono">
                  Duration: <tspan fill="#3fb950">{selectedPoint.duration}</tspan> • {selectedPoint.location}
                </text>
              </g>
            )}
          </svg>
        </div>

        {/* FLOATING FILTER CONTROLS (Top-Left) */}
        <div className="absolute top-4 left-4 z-20 w-72 rounded border border-pd-border bg-pd-surface/95 backdrop-blur p-3.5 shadow-2xl space-y-3">
          <div className="flex items-center justify-between border-b border-pd-border/60 pb-2">
            <div className="font-bold text-pd-sm text-pd-text-primary">{entityName}</div>
            <span className="font-mono text-[10px] text-pd-accent">Geospatial Routine</span>
          </div>

          {/* Date Picker Input */}
          <div>
            <div className="text-[10px] font-semibold uppercase text-pd-text-tertiary mb-1">Observation Window</div>
            <input
              type="text"
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="w-full h-7 rounded border border-pd-border bg-pd-base px-2 text-pd-xs font-mono text-pd-text-primary focus:outline-none focus:border-pd-accent"
            />
          </div>

          {/* Layer Checkboxes */}
          <div className="space-y-1.5 text-pd-xs pt-1">
            <label className="flex items-center gap-2 cursor-pointer hover:text-pd-text-primary">
              <input
                type="checkbox"
                checked={showPings}
                onChange={(e) => setShowPings(e.target.checked)}
                className="accent-pd-accent rounded"
              />
              <span className="flex items-center gap-1.5 text-pd-text-secondary">
                <span className="h-2 w-2 rounded-full bg-pd-accent" />
                CDR Pings (7 Points)
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer hover:text-pd-text-primary">
              <input
                type="checkbox"
                checked={showLoop}
                onChange={(e) => setShowLoop(e.target.checked)}
                className="accent-pd-accent rounded"
              />
              <span className="flex items-center gap-1.5 text-pd-text-secondary">
                <span className="h-2 w-2 rounded-sm bg-[#58a6ff]" />
                Routine Daily Loop
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer hover:text-pd-text-primary">
              <input
                type="checkbox"
                checked={showHotspots}
                onChange={(e) => setShowHotspots(e.target.checked)}
                className="accent-pd-accent rounded"
              />
              <span className="flex items-center gap-1.5 text-pd-text-secondary">
                <span className="h-2 w-2 rounded-full bg-[#58a6ff]/40" />
                Hotspots (20% Opacity)
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer hover:text-pd-text-primary">
              <input
                type="checkbox"
                checked={showAssociates}
                onChange={(e) => setShowAssociates(e.target.checked)}
                className="accent-pd-accent rounded"
              />
              <span className="flex items-center gap-1.5 text-pd-text-secondary">
                <span className="h-2 w-2 rounded-full bg-pd-warning" />
                Associate Meeting Nodes
              </span>
            </label>
          </div>
        </div>

        {/* MAP LEGEND (Bottom-Left) */}
        <div className="absolute bottom-4 left-4 z-20 rounded border border-pd-border bg-pd-surface/90 backdrop-blur p-2.5 text-pd-xs space-y-1.5 shadow-lg">
          <div className="text-[10px] font-bold uppercase tracking-wider text-pd-text-tertiary">Map Legend</div>
          <div className="flex items-center gap-2 text-pd-text-secondary">
            <span className="h-2 w-2 rounded-full bg-pd-success" />
            Home (Dharavi)
          </div>
          <div className="flex items-center gap-2 text-pd-text-secondary">
            <span className="h-2 w-2 rounded-full bg-pd-accent" />
            Work / Safehouse (Andheri)
          </div>
          <div className="flex items-center gap-2 text-pd-text-secondary">
            <span className="h-2 w-2 rounded-full bg-pd-warning" />
            Associate (Bandra)
          </div>
          <div className="flex items-center gap-2 text-pd-text-secondary">
            <span className="h-0.5 w-3 bg-pd-accent" />
            Predicted Routine Route
          </div>
        </div>

        {/* ZOOM CONTROLS (Bottom-Right of Canvas) */}
        <div className="absolute bottom-4 right-84 z-20 flex flex-col gap-1 rounded border border-pd-border bg-pd-surface p-1 shadow-lg">
          <button
            onClick={() => setZoom(Math.min(2, zoom + 0.2))}
            className="flex h-7 w-7 items-center justify-center rounded bg-pd-elevated text-pd-text-secondary hover:text-pd-text-primary font-bold"
          >
            +
          </button>
          <button
            onClick={() => setZoom(Math.max(0.6, zoom - 0.2))}
            className="flex h-7 w-7 items-center justify-center rounded bg-pd-elevated text-pd-text-secondary hover:text-pd-text-primary font-bold"
          >
            -
          </button>
        </div>
      </div>

      {/* RIGHT SIDEBAR: LOCATION HISTORY & FREQUENT PLACES */}
      <div className="w-80 border-l border-pd-border bg-pd-surface p-4 flex flex-col justify-between overflow-y-auto select-none space-y-4">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-pd-border pb-2">
            <span className="text-pd-xs font-bold uppercase tracking-wider text-pd-text-tertiary">
              Location History
            </span>
            <span className="rounded bg-pd-accent/15 px-2 py-0.5 font-mono text-[10px] font-bold text-pd-accent border border-pd-accent/30">
              147 Pings
            </span>
          </div>

          {/* Raw Data Log Table */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold uppercase text-pd-text-tertiary">Raw Data Log</div>
            <div className="rounded border border-pd-border bg-pd-base overflow-hidden">
              <table className="w-full text-left text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-pd-border bg-pd-elevated/60 text-pd-text-tertiary">
                    <th className="px-2 py-1">Time (UTC)</th>
                    <th className="px-2 py-1">Location</th>
                    <th className="px-2 py-1 text-right">Dur</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-pd-border/30">
                  {DEMO_PINGS.map((p) => {
                    const isSelected = selectedPoint?.id === p.id;
                    return (
                      <tr
                        key={p.id}
                        onClick={() => setSelectedPoint(p)}
                        className={`h-7 cursor-pointer transition-colors ${
                          isSelected ? "bg-pd-accent/20 text-pd-accent font-semibold" : "hover:bg-pd-elevated text-pd-text-primary"
                        }`}
                      >
                        <td className="px-2 py-1">{p.time}</td>
                        <td className="px-2 py-1 truncate max-w-[100px]">{p.location}</td>
                        <td className="px-2 py-1 text-right text-pd-text-tertiary">{p.duration}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* FREQUENT LOCATIONS RANKING */}
          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase text-pd-text-tertiary">Frequent Locations</div>
            <div className="space-y-2.5 text-pd-xs">
              {/* Location 1 */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-pd-text-primary flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-pd-success" />
                    Dharavi (Home Base)
                  </span>
                  <span className="font-mono text-pd-text-tertiary">82 pings</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-pd-elevated overflow-hidden">
                  <div className="h-full bg-pd-success w-[56%]" />
                </div>
              </div>

              {/* Location 2 */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-pd-text-primary flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-pd-accent" />
                    Andheri East (Work / Safehouse)
                  </span>
                  <span className="font-mono text-pd-text-tertiary">45 pings</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-pd-elevated overflow-hidden">
                  <div className="h-full bg-pd-accent w-[31%]" />
                </div>
              </div>

              {/* Location 3 */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-pd-text-primary flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-pd-warning" />
                    Bandra Station
                  </span>
                  <span className="font-mono text-pd-text-tertiary">32 pings</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-pd-elevated overflow-hidden">
                  <div className="h-full bg-pd-warning w-[22%]" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Export Button */}
        <button
          onClick={() => alert(`Exporting KML geospatial route for ${entityName}...`)}
          className="flex w-full h-8 items-center justify-center gap-1.5 rounded border border-pd-border bg-pd-elevated text-pd-xs font-bold text-pd-text-primary hover:bg-pd-base transition-colors"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export KML Vector Route
        </button>
      </div>
    </div>
  );
}
