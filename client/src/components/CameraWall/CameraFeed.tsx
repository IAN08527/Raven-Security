import { useCallback, useRef, useState } from "react";
import type { CameraView } from "../../types/api";
import { useCvBoxesOverlay } from "../../lib/overlaySocket";
import { BoxOverlay } from "./BoxOverlay";
import { FeedStatusBar } from "./FeedStatusBar";

interface CameraFeedProps {
  camera: CameraView;
  onSelect: (cameraId: string) => void;
}

interface FrameSize {
  width: number;
  height: number;
}

/**
 * One tile: MJPEG `<img>` (D3) plus an independently re-rendering SVG box
 * overlay (ARCHITECTURE.md §2), a status bar, and a graceful placeholder
 * when the engine node isn't serving this feed. Never crashes on a broken
 * or absent stream -- `onError` on the `<img>` degrades to the placeholder
 * exactly like a camera whose `status` already says unavailable.
 */
export function CameraFeed({ camera, onSelect }: CameraFeedProps): JSX.Element {
  const [imgFailed, setImgFailed] = useState(false);
  const [frameSize, setFrameSize] = useState<FrameSize | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const streamAvailable = camera.status === "online" && camera.stream_url !== null && !imgFailed;
  const overlay = useCvBoxesOverlay(streamAvailable ? camera.stream_url : null, camera.code);

  const handleLoad = useCallback(() => {
    const img = imgRef.current;
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      setFrameSize({ width: img.naturalWidth, height: img.naturalHeight });
    }
  }, []);

  const handleError = useCallback(() => {
    setImgFailed(true);
  }, []);

  const belowFloor = overlay.payload?.below_quality_floor ?? false;
  const effectiveFps = overlay.payload?.effective_fps ?? camera.effective_fps;

  return (
    <div
      className={`group flex h-full w-full flex-col overflow-hidden rounded-md bg-[#151514] transition-[border-color] duration-[180ms] ease-out ${
        belowFloor ? "border-2 border-[#C9A653]" : "border border-[#30302D]"
      } cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#668DBA]`}
      onClick={() => onSelect(camera.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(camera.id);
        }
      }}
    >
      <div className="relative min-h-0 flex-1 bg-black">
        {streamAvailable ? (
          <>
            <img
              ref={imgRef}
              src={camera.stream_url ?? undefined}
              alt={`Live feed: ${camera.code}`}
              className="h-full w-full object-contain"
              onLoad={handleLoad}
              onError={handleError}
            />
            {frameSize && overlay.payload && (
              <BoxOverlay boxes={overlay.payload.boxes} frameWidth={frameSize.width} frameHeight={frameSize.height} />
            )}
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[#1B1B19]">
            <span className="text-sm font-medium text-[#A5A29A]">FEED UNAVAILABLE</span>
            <span className="text-xs text-[#706E68]">{camera.code}</span>
          </div>
        )}
      </div>
      <FeedStatusBar
        code={camera.code}
        declaredStartTs={camera.declared_start_ts}
        effectiveFps={effectiveFps}
        belowQualityFloor={belowFloor}
      />
    </div>
  );
}
