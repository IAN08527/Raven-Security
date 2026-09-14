import type { Camera } from "../types/api";
import { CameraWall } from "../components/CameraWall";
import { FeedStatusBar } from "../components/CameraWall/FeedStatusBar";

/**
 * Dev-only harness for eyeballing M1-T7's acceptance criteria without a
 * live server/engine node -- neither exists end-to-end yet (server's
 * current `GET /cameras` is scoped to M1-T1's fields only; see the note in
 * `main.tsx`). Every `stream_url` here is a local `data:` URI, so nothing
 * leaves the machine (CLAUDE.md rule 6) and nothing here is presented as a
 * real measurement (rule 10) -- it is pixels for the `<img>` element to
 * load, nothing more. Nine tiles total exercises the "8 or more feeds"
 * criterion in a real render pass.
 *
 * `cv.boxes` overlays and the warning band both require a real engine-node
 * WebSocket (API_CONTRACTS.md §3.2), so they can't be faked through
 * `CameraWall` itself without a backdoor in production code. The warning
 * band is instead previewed directly below the grid, using the same
 * `FeedStatusBar` component with a hand-set prop, clearly labelled as a
 * static preview rather than a tenth camera.
 */

function placeholderFrame(label: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
    <rect width="1280" height="720" fill="hsl(${hue} 25% 14%)" />
    <text x="640" y="360" fill="hsl(${hue} 20% 60%)" font-size="48" font-family="monospace"
          text-anchor="middle" dominant-baseline="middle">${label}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const DECLARED_START = "2025-11-02T14:00:00.000Z";

function onlineCamera(index: number, effectiveFps: number): Camera {
  const code = `cam_${String(index).padStart(2, "0")}`;
  return {
    id: code,
    code,
    label: `Entrance ${index}`,
    lat: null,
    lon: null,
    mode: index % 2 === 0 ? "live" : "recorded",
    declared_start_ts: DECLARED_START,
    fps: 10,
    effective_fps: effectiveFps,
    status: "online",
    node_id: "node-1",
    stream_url: placeholderFrame(code, (index * 47) % 360),
  };
}

function offlineCamera(index: number): Camera {
  const code = `cam_${String(index).padStart(2, "0")}`;
  return {
    id: code,
    code,
    label: `Loading Dock ${index}`,
    lat: null,
    lon: null,
    mode: "live",
    declared_start_ts: DECLARED_START,
    fps: 10,
    effective_fps: null,
    status: "offline",
    node_id: null,
    stream_url: null,
  };
}

const DEMO_CAMERAS: Camera[] = [
  onlineCamera(1, 10),
  onlineCamera(2, 9.8),
  onlineCamera(3, 10),
  onlineCamera(4, 7.2),
  onlineCamera(5, 10),
  onlineCamera(6, 9.1),
  onlineCamera(7, 10),
  offlineCamera(8),
  offlineCamera(9),
];

export function CameraWallDemo(): JSX.Element {
  return (
    <div className="flex h-screen w-screen flex-col bg-[#151514]">
      <div className="min-h-0 flex-[3]">
        <CameraWall cameras={DEMO_CAMERAS} />
      </div>
      <div className="shrink-0 border-t border-[#30302D] p-4">
        <p className="mb-2 text-xs text-[#706E68]">
          Warning band preview (static -- below_quality_floor comes from a live cv.boxes event, not from this demo)
        </p>
        <div className="w-64 overflow-hidden rounded-md border-2 border-[#C9A653]">
          <div className="flex h-20 items-center justify-center bg-black text-xs text-[#706E68]">video area</div>
          <FeedStatusBar code="cam_10" declaredStartTs={DECLARED_START} effectiveFps={3.2} belowQualityFloor />
        </div>
      </div>
    </div>
  );
}
