import { useState, useMemo, useRef, useEffect } from "react";
import { useCaseStore } from "../../store/case";

interface HubNode {
  id: string;
  label: string;
  alias?: string;
  type: "LEADER" | "HAWALA" | "LOGISTICS" | "ORGANIZATION" | "LOCATION" | "VEHICLE";
  threatScore: number;
  badgeCount: number;
  x: number;
  y: number;
  color: string;
  subLabel: string;
}

interface SatelliteNode {
  id: string;
  hubId: string;
  label: string;
  type: string;
  x: number;
  y: number;
  size: number;
}

interface WebEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  isMain?: boolean;
}

// 6 Major Tactical Hubs matching the high-contrast geometric style of the Dribbble reference
const PRIMARY_HUBS: HubNode[] = [
  {
    id: "hub-sawant",
    label: "Rakesh Sawant",
    alias: "Ricky",
    type: "LEADER",
    threatScore: 0.92,
    badgeCount: 22,
    x: 680,
    y: 160,
    color: "#e63946", // Crimson Red
    subLabel: "SYNDICATE LEADER",
  },
  {
    id: "hub-patel",
    label: "Vikram Patel",
    alias: "Vicky",
    type: "HAWALA",
    threatScore: 0.62,
    badgeCount: 18,
    x: 540,
    y: 220,
    color: "#2563eb", // Royal Electric Blue
    subLabel: "HAWALA OPERATOR",
  },
  {
    id: "hub-fir102",
    label: "FIR-102 Syndicate",
    type: "ORGANIZATION",
    threatScore: 0.85,
    badgeCount: 15,
    x: 720,
    y: 200,
    color: "#dc2626", // Deep Red
    subLabel: "ARMED CONSPIRACY",
  },
  {
    id: "hub-khan",
    label: "Mohd. Khan",
    alias: "Bhai",
    type: "LOGISTICS",
    threatScore: 0.51,
    badgeCount: 12,
    x: 430,
    y: 450,
    color: "#d97706", // Amber Gold
    subLabel: "ARMS & LOGISTICS",
  },
  {
    id: "hub-quickpay",
    label: "QuickPay Solutions",
    type: "ORGANIZATION",
    threatScore: 0.44,
    badgeCount: 8,
    x: 610,
    y: 310,
    color: "#0284c7", // Sky Blue
    subLabel: "SHELL ROUTING",
  },
  {
    id: "hub-dharavi",
    label: "Dharavi HQ",
    type: "LOCATION",
    threatScore: 0.70,
    badgeCount: 7,
    x: 560,
    y: 580,
    color: "#16a34a", // Emerald Green
    subLabel: "COMMAND BASE",
  },
];

// Generate dense constellation of 60+ micro satellite nodes clustered organically around hubs
function generateSatellites(): { satellites: SatelliteNode[]; edges: WebEdge[] } {
  const satellites: SatelliteNode[] = [];
  const edges: WebEdge[] = [];

  // Connect primary hubs with main arteries
  edges.push(
    { id: "e-h1", source: "hub-sawant", target: "hub-fir102", weight: 35, isMain: true },
    { id: "e-h2", source: "hub-sawant", target: "hub-patel", weight: 30, isMain: true },
    { id: "e-h3", source: "hub-patel", target: "hub-quickpay", weight: 25, isMain: true },
    { id: "e-h4", source: "hub-sawant", target: "hub-khan", weight: 20, isMain: true },
    { id: "e-h5", source: "hub-khan", target: "hub-dharavi", weight: 25, isMain: true },
    { id: "e-h6", source: "hub-quickpay", target: "hub-dharavi", weight: 15, isMain: true }
  );

  const satelliteLabels = [
    "CDR-8842", "UPI-2.4L", "MH02AB1234", "Safehouse-402", "Aadhaar-4521",
    "Wire-8492", "Sim-Jio98", "HDFC-0012", "Toll-Vashi", "CCTV-Cam01",
    "DK-Deepak", "A.Roy", "S.Gupta", "M.Nair", "R.More",
    "SIM-Burner2", "Cash-Drop", "NAFIS-Hit", "Arms-9mm", "Bandra-Term",
    "Gaikwad", "Deshmukh", "Hawala-Dubai", "Call-47x", "Tower-0847"
  ];

  PRIMARY_HUBS.forEach((hub, hIdx) => {
    // Generate 8-12 satellite nodes orbiting each hub
    const count = 9;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI + (hIdx * 0.4);
      const dist = 45 + ((i * 17) % 55);
      const satId = `sat-${hub.id}-${i}`;
      const satX = hub.x + Math.cos(angle) * dist + (Math.sin(i * 3) * 10);
      const satY = hub.y + Math.sin(angle) * dist + (Math.cos(i * 2) * 10);
      const label = satelliteLabels[(hIdx * count + i) % satelliteLabels.length];

      satellites.push({
        id: satId,
        hubId: hub.id,
        label,
        type: i % 3 === 0 ? "PHONE" : i % 3 === 1 ? "TXN" : "EVENT",
        x: satX,
        y: satY,
        size: 2.5 + (i % 3),
      });

      // Edge from hub to satellite
      edges.push({
        id: `e-${hub.id}-${satId}`,
        source: hub.id,
        target: satId,
        weight: 5 + (i % 10),
      });

      // Cross-connect some satellites to create rich spiderweb mesh
      if (i > 0 && i % 2 === 0) {
        edges.push({
          id: `e-cross-${satId}`,
          source: satId,
          target: `sat-${hub.id}-${i - 1}`,
          weight: 2,
        });
      }
    }
  });

  return { satellites, edges };
}

export function GraphPane() {
  const openTab = useCaseStore((s) => s.openTab);
  const layerFilters = useCaseStore((s) => s.layerFilters);
  const setLayerFilter = useCaseStore((s) => s.setLayerFilter);

  // Active focused hub (Default to Rakesh Sawant)
  const [selectedHubId, setSelectedHubId] = useState<string>("hub-sawant");
  const [timelineYear, setTimelineYear] = useState<number>(2024);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(0.88);
  const [showFilterDrawer, setShowFilterDrawer] = useState<boolean>(false);
  const [showLegend, setShowLegend] = useState<boolean>(false);

  const { satellites, edges } = useMemo(() => generateSatellites(), []);

  const selectedHub = useMemo(
    () => PRIMARY_HUBS.find((h) => h.id === selectedHubId) || PRIMARY_HUBS[0],
    [selectedHubId]
  );

  // Helper to render polygon hexagon path
  const getHexagonPath = (cx: number, cy: number, r: number) => {
    const points: string[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (i * 60 * Math.PI) / 180;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      points.push(`${x},${y}`);
    }
    return `M ${points.join(" L ")} Z`;
  };

  return (
    <div className="flex h-full w-full bg-[#05080d] text-pd-text-primary overflow-hidden relative select-none font-sans">
      {/* FULL CANVAS GRAPH WORKSPACE (DENSE SPIDERWEB MESH) */}
      <div className="flex-1 h-full relative flex items-center justify-center overflow-hidden">
        {/* SVG Network Graph Canvas */}
        <div
          className="w-full h-full relative flex items-center justify-center transition-transform duration-300"
          style={{ transform: `scale(${zoom})` }}
        >
          <svg className="w-full h-full" viewBox="0 0 1100 750">
            <defs>
              {/* Radial glow filter for major nodes */}
              <filter id="glow-red" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="glow-lime" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              {/* Radial backdrop glow */}
              <radialGradient id="mesh-center-glow" cx="60%" cy="40%" r="50%">
                <stop offset="0%" stopColor="#1e293b" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#05080d" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* Canvas Ambient Center Glow */}
            <circle cx="580" cy="380" r="450" fill="url(#mesh-center-glow)" />

            {/* Micro grid coordinate dots */}
            <g opacity="0.15">
              {Array.from({ length: 22 }).map((_, r) =>
                Array.from({ length: 30 }).map((_, c) => (
                  <circle key={`dot-${r}-${c}`} cx={c * 40} cy={r * 38} r="0.75" fill="#64748b" />
                ))
              )}
            </g>

            {/* 1. DELICATE BACKGROUND SPIDERWEB EDGES (HAIRLINE LINES) */}
            <g>
              {edges.map((e) => {
                const srcNode =
                  PRIMARY_HUBS.find((h) => h.id === e.source) ||
                  satellites.find((s) => s.id === e.source);
                const dstNode =
                  PRIMARY_HUBS.find((h) => h.id === e.target) ||
                  satellites.find((s) => s.id === e.target);

                if (!srcNode || !dstNode) return null;

                const isConnectedToSelected =
                  e.source === selectedHubId || e.target === selectedHubId;

                // Glowing Neon-Lime Ray line if connected to active node
                if (isConnectedToSelected) {
                  return (
                    <line
                      key={e.id}
                      x1={srcNode.x}
                      y1={srcNode.y}
                      x2={dstNode.x}
                      y2={dstNode.y}
                      stroke="#86efac"
                      strokeWidth="1.5"
                      strokeDasharray="4 3"
                      opacity="0.9"
                    />
                  );
                }

                return (
                  <line
                    key={e.id}
                    x1={srcNode.x}
                    y1={srcNode.y}
                    x2={dstNode.x}
                    y2={dstNode.y}
                    stroke={e.isMain ? "#334155" : "#1e293b"}
                    strokeWidth={e.isMain ? "1.0" : "0.6"}
                    opacity={e.isMain ? 0.6 : 0.25}
                  />
                );
              })}
            </g>

            {/* 2. SATELLITE MICRO NODES (TINY DELICATE DOTS WITH FAINT LABELS) */}
            <g>
              {satellites.map((sat) => {
                const isSelectedCluster = sat.hubId === selectedHubId;
                return (
                  <g key={sat.id} className="cursor-pointer">
                    <circle
                      cx={sat.x}
                      cy={sat.y}
                      r={isSelectedCluster ? sat.size + 1 : sat.size}
                      fill={isSelectedCluster ? "#86efac" : "#64748b"}
                      opacity={isSelectedCluster ? 0.9 : 0.5}
                    />
                    <text
                      x={sat.x}
                      y={sat.y - 4}
                      textAnchor="middle"
                      fill={isSelectedCluster ? "#cbd5e1" : "#475569"}
                      fontSize="7.5"
                      fontFamily="JetBrains Mono"
                      opacity={isSelectedCluster ? 0.9 : 0.4}
                    >
                      {sat.label}
                    </text>
                  </g>
                );
              })}
            </g>

            {/* 3. PRIMARY GEOMETRIC HEXAGON HUBS (MATCHING DRIBBLE DESIGN) */}
            <g>
              {PRIMARY_HUBS.map((hub) => {
                const isSelected = hub.id === selectedHubId;
                const hexRadius = isSelected ? 24 : 20;

                return (
                  <g
                    key={hub.id}
                    onClick={() => setSelectedHubId(hub.id)}
                    className="cursor-pointer group"
                  >
                    {/* Outer radiant halo if selected */}
                    {isSelected && (
                      <path
                        d={getHexagonPath(hub.x, hub.y, hexRadius + 8)}
                        fill="none"
                        stroke="#86efac"
                        strokeWidth="1.5"
                        strokeDasharray="4 3"
                        className="animate-spin"
                        style={{ transformOrigin: `${hub.x}px ${hub.y}px` }}
                      />
                    )}

                    {/* Main Hexagon Body */}
                    <path
                      d={getHexagonPath(hub.x, hub.y, hexRadius)}
                      fill={isSelected ? "#15803d" : hub.color}
                      stroke={isSelected ? "#86efac" : "#ffffff"}
                      strokeWidth={isSelected ? "2.5" : "1.5"}
                      filter={isSelected ? "url(#glow-lime)" : "url(#glow-red)"}
                      opacity={isSelected ? 1 : 0.92}
                    />

                    {/* White Numerical Badge / Degree Count inside Hexagon */}
                    <text
                      x={hub.x}
                      y={hub.y + 4.5}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="12"
                      fontFamily="JetBrains Mono"
                      fontWeight="bold"
                    >
                      {hub.badgeCount}
                    </text>

                    {/* Uppercase Name Label Floating Directly Above */}
                    <text
                      x={hub.x}
                      y={hub.y - hexRadius - 6}
                      textAnchor="middle"
                      fill={isSelected ? "#86efac" : "#f1f5f9"}
                      fontSize="10"
                      fontFamily="Inter"
                      fontWeight="700"
                      className="uppercase tracking-wider"
                    >
                      {hub.label}
                    </text>

                    {/* Sub-label Role */}
                    <text
                      x={hub.x}
                      y={hub.y + hexRadius + 11}
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize="7.5"
                      fontFamily="JetBrains Mono"
                      className="uppercase tracking-tight"
                    >
                      {hub.subLabel}
                    </text>
                  </g>
                );
              })}
            </g>

            {/* 4. PINNED IN-CANVAS HUD TOOLTIP CARD (MATCHING KAWASAKI HUD IN DRIBBLE PHOTO) */}
            {selectedHub && (
              <g transform={`translate(${selectedHub.x + 36}, ${selectedHub.y - 65})`}>
                {/* HUD Background Box */}
                <rect
                  width="180"
                  height="135"
                  rx="3"
                  fill="#090d14"
                  stroke="#1e293b"
                  strokeWidth="1.2"
                  filter="drop-shadow(0 12px 24px rgba(0,0,0,0.85))"
                />

                {/* Top Green Accent Line */}
                <line x1="0" y1="0" x2="180" y2="0" stroke="#86efac" strokeWidth="2.5" />

                {/* Subtitle / Category */}
                <text x="12" y="18" fill="#64748b" fontSize="8" fontFamily="JetBrains Mono" fontWeight="700" className="uppercase tracking-widest">
                  CONSTRUCTOR / SYNDICATE
                </text>

                {/* Timeline Range */}
                <text x="12" y="32" fill="#94a3b8" fontSize="9" fontFamily="JetBrains Mono">
                  1987 — 2024
                </text>

                {/* Main Name */}
                <text x="12" y="48" fill="#f8fafc" fontSize="13" fontFamily="Inter" fontWeight="800">
                  {selectedHub.label}
                </text>

                {/* Divider */}
                <line x1="12" y1="56" x2="168" y2="56" stroke="#1e293b" strokeWidth="0.8" />

                {/* TOTALS Metrics */}
                <text x="12" y="68" fill="#64748b" fontSize="7.5" fontFamily="JetBrains Mono" fontWeight="700" className="uppercase">
                  TOTALS
                </text>

                <text x="12" y="82" fill="#94a3b8" fontSize="8.5" fontFamily="Inter">
                  Threat Score: <tspan fill="#ef4444" fontWeight="bold">0.92</tspan>
                </text>
                <text x="12" y="96" fill="#94a3b8" fontSize="8.5" fontFamily="Inter">
                  Connected Entities: <tspan fill="#86efac" fontWeight="bold">28</tspan>
                </text>
                <text x="12" y="110" fill="#94a3b8" fontSize="8.5" fontFamily="Inter">
                  Cases: <tspan fill="#f1f5f9" fontWeight="bold">4</tspan>
                </text>

                {/* Clickable CTA in HUD */}
                <g
                  onClick={() => {
                    openTab({
                      id: `profile-0a5f9733-d8c7-5ea7-a36c-94fbba2ec332`,
                      type: "profile",
                      title: `Profile: ${selectedHub.label}`,
                      data: {
                        entityId: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332",
                        entityName: selectedHub.label,
                      },
                    });
                  }}
                  className="cursor-pointer"
                >
                  <rect x="12" y="118" width="156" height="12" rx="2" fill="#1e293b" />
                  <text x="90" y="127" textAnchor="middle" fill="#86efac" fontSize="7.5" fontFamily="Inter" fontWeight="bold">
                    EXPAND FULL PROFILE →
                  </text>
                </g>
              </g>
            )}
          </svg>
        </div>

        {/* TOP-LEFT FLOATING HUD CONTROLS */}
        <div className="absolute top-4 left-4 z-30 flex items-center gap-2">
          {/* Filtering Options Button */}
          <button
            onClick={() => setShowFilterDrawer(!showFilterDrawer)}
            className="flex h-8 items-center gap-2 rounded-sm border border-pd-border bg-[#0d1117]/90 backdrop-blur px-3 text-[11px] font-mono font-semibold uppercase tracking-wider text-pd-text-primary hover:border-pd-accent transition-colors shadow-lg"
          >
            <svg className="h-3.5 w-3.5 text-pd-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
            FILTERING OPTIONS
          </button>

          {/* Constructors / Syndicate Selector */}
          <div className="relative">
            <select
              value={selectedHubId}
              onChange={(e) => setSelectedHubId(e.target.value)}
              className="h-8 rounded-sm border border-pd-border bg-[#0d1117]/90 backdrop-blur px-2.5 text-[11px] font-mono font-semibold uppercase text-pd-text-primary focus:border-pd-accent focus:outline-none shadow-lg cursor-pointer"
            >
              {PRIMARY_HUBS.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* TOP-RIGHT FLOATING HUD (RESET VIEW / FULLSCREEN) */}
        <div className="absolute top-4 right-4 z-30 flex items-center gap-2">
          <button
            onClick={() => {
              setZoom(0.88);
              setSelectedHubId("hub-sawant");
            }}
            className="flex h-8 items-center gap-1.5 rounded-sm border border-pd-border bg-[#0d1117]/90 backdrop-blur px-3 text-[10px] font-mono font-bold uppercase tracking-wider text-pd-text-secondary hover:text-pd-text-primary hover:border-pd-border transition-colors shadow-lg"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            RESET VIEW
          </button>

          <button
            onClick={() => setZoom(zoom === 1 ? 0.88 : 1)}
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-pd-border bg-[#0d1117]/90 backdrop-blur text-pd-text-secondary hover:text-pd-text-primary shadow-lg"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
        </div>

        {/* LAYER FILTER POP-OUT DRAWER */}
        {showFilterDrawer && (
          <div className="absolute top-14 left-4 z-40 w-64 rounded-sm border border-pd-border bg-[#0d1117]/95 backdrop-blur p-3.5 shadow-2xl space-y-3 animate-in fade-in zoom-in-95 duration-100 font-mono text-pd-xs">
            <div className="flex items-center justify-between border-b border-pd-border/60 pb-2">
              <span className="font-bold text-pd-text-primary uppercase tracking-wider">Entity Layers</span>
              <button onClick={() => setShowFilterDrawer(false)} className="text-pd-text-tertiary hover:text-pd-text-primary">✕</button>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-pd-text-primary cursor-pointer">
                <input type="checkbox" checked disabled className="accent-pd-accent rounded" />
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#e63946]" />
                  Kingpin Hubs (Locked ON)
                </span>
              </label>

              <label className="flex items-center gap-2 text-pd-text-secondary hover:text-pd-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={layerFilters.accounts}
                  onChange={(e) => setLayerFilter("accounts", e.target.checked)}
                  className="accent-pd-accent rounded"
                />
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-sm bg-[#2563eb]" />
                  Hawala / Financial Nodes
                </span>
              </label>

              <label className="flex items-center gap-2 text-pd-text-secondary hover:text-pd-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={layerFilters.institutions}
                  onChange={(e) => setLayerFilter("institutions", e.target.checked)}
                  className="accent-pd-accent rounded"
                />
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-sm bg-[#d97706]" />
                  Logistics & Crime FIRs
                </span>
              </label>

              <label className="flex items-center gap-2 text-pd-text-secondary hover:text-pd-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={layerFilters.vehicles}
                  onChange={(e) => setLayerFilter("vehicles", e.target.checked)}
                  className="accent-pd-accent rounded"
                />
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-sm bg-[#16a34a]" />
                  Location Safehouses
                </span>
              </label>
            </div>
          </div>
        )}

        {/* BOTTOM LEFT HUD (LEGEND BUTTON) */}
        <div className="absolute bottom-16 left-4 z-30">
          <button
            onClick={() => setShowLegend(!showLegend)}
            className="flex h-7 items-center gap-1.5 rounded-sm border border-pd-border bg-[#0d1117]/90 backdrop-blur px-2.5 text-[10px] font-mono font-bold uppercase tracking-wider text-pd-text-secondary hover:text-pd-text-primary shadow-lg"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            LEGEND
          </button>

          {showLegend && (
            <div className="mt-2 rounded-sm border border-pd-border bg-[#0d1117]/95 backdrop-blur p-2.5 text-[10px] font-mono space-y-1.5 shadow-2xl">
              <div className="flex items-center gap-2 text-pd-text-secondary">
                <span className="h-2.5 w-2.5 bg-[#e63946] rounded-xs" />
                Kingpin Leader
              </div>
              <div className="flex items-center gap-2 text-pd-text-secondary">
                <span className="h-2.5 w-2.5 bg-[#2563eb] rounded-xs" />
                Hawala Network
              </div>
              <div className="flex items-center gap-2 text-pd-text-secondary">
                <span className="h-2.5 w-2.5 bg-[#d97706] rounded-xs" />
                Arms / Logistics
              </div>
              <div className="flex items-center gap-2 text-pd-text-secondary">
                <span className="h-2.5 w-2.5 bg-[#16a34a] rounded-xs" />
                Location Node
              </div>
              <div className="flex items-center gap-2 text-pd-text-tertiary">
                <span className="h-1.5 w-1.5 rounded-full bg-[#64748b]" />
                Micro Evidence Satellite
              </div>
            </div>
          )}
        </div>

        {/* BOTTOM HORIZONTAL TIMELINE HUD BAR (EXACTLY LIKE THE DRIBBLE REFERENCE) */}
        <div className="absolute bottom-3 inset-x-4 z-30 h-10 rounded-sm border border-pd-border bg-[#0d1117]/95 backdrop-blur px-4 flex items-center justify-between shadow-2xl font-mono text-[11px]">
          {/* Left Playback & Year Controls */}
          <div className="flex items-center gap-2.5">
            <span className="text-pd-text-tertiary uppercase font-bold text-[10px] tracking-wider">
              SEASONS
            </span>
            <span className="px-2 py-0.5 rounded bg-pd-elevated text-pd-text-primary font-bold border border-pd-border">
              2021
            </span>
            <span className="px-2 py-0.5 rounded bg-pd-elevated text-pd-accent font-bold border border-pd-accent/60">
              {timelineYear}
            </span>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-pd-elevated text-pd-text-secondary hover:text-pd-text-primary border border-pd-border"
            >
              {isPlaying ? "⏸ PAUSE" : "▶ PLAY"}
            </button>
          </div>

          {/* Center Timeline Ruler Slider */}
          <div className="flex-1 mx-8 flex items-center gap-3">
            <span className="text-[10px] text-pd-text-tertiary">1980</span>
            <div className="flex-1 relative flex items-center">
              <input
                type="range"
                min="1980"
                max="2024"
                value={timelineYear}
                onChange={(e) => setTimelineYear(Number(e.target.value))}
                className="w-full accent-pd-accent h-1.5 bg-[#1e293b] rounded cursor-pointer"
              />
            </div>
            <span className="text-[10px] text-pd-text-tertiary">2024</span>
          </div>

          {/* Right Zoom Controls */}
          <div className="flex items-center gap-2">
            <span className="text-pd-text-tertiary font-bold text-[10px]">
              {zoom.toFixed(2)}
            </span>
            <button
              onClick={() => setZoom(Math.max(0.6, zoom - 0.1))}
              className="h-6 w-6 rounded bg-pd-elevated text-pd-text-secondary hover:text-pd-text-primary border border-pd-border flex items-center justify-center font-bold"
            >
              -
            </button>
            <button
              onClick={() => setZoom(Math.min(1.6, zoom + 0.1))}
              className="h-6 w-6 rounded bg-pd-elevated text-pd-text-secondary hover:text-pd-text-primary border border-pd-border flex items-center justify-center font-bold"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
