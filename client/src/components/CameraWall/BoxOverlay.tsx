import type { Box } from "../../types/api";

interface BoxOverlayProps {
  boxes: Box[];
  frameWidth: number;
  frameHeight: number;
}

// Blue/Information for ordinary detections, Purple/Secondary for a locked-on
// target's box -- design(1).md §3.2. Not green: a track being followed is
// not a confirmed identity (D9), and green is reserved for "Confirmed"
// (§3.3).
const BOX_COLOR = "#668DBA";
const TARGET_COLOR = "#8273A8";

/**
 * Pure SVG, no library. Re-renders only when `boxes` changes -- the parent
 * MJPEG `<img>` is a sibling element and is never touched by this component
 * (D3, ARCHITECTURE.md §2).
 */
export function BoxOverlay({ boxes, frameWidth, frameHeight }: BoxOverlayProps): JSX.Element {
  const strokeWidth = Math.max(frameWidth, frameHeight) / 240;
  const fontSize = Math.max(frameWidth, frameHeight) / 45;

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${frameWidth} ${frameHeight}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {boxes.map((box, i) => {
        const [x, y, w, h] = box.bbox;
        const color = box.is_target ? TARGET_COLOR : BOX_COLOR;
        const labelY = y > fontSize ? y - fontSize * 0.3 : y + h + fontSize;
        return (
          <g key={`${box.track_id ?? "u"}-${i}`}>
            <rect x={x} y={y} width={w} height={h} fill="none" stroke={color} strokeWidth={strokeWidth} />
            {box.track_id !== null && (
              <text x={x} y={labelY} fill={color} fontSize={fontSize} fontFamily="monospace">
                #{box.track_id} {(box.conf * 100).toFixed(0)}%
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
