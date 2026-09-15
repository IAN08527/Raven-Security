import { useMemo, useState } from "react";
import type { CameraView } from "../../types/api";
import { CameraFeed } from "./CameraFeed";

interface CameraWallProps {
  cameras: CameraView[];
}

function gridColumns(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

/**
 * M1-T7. Renders every registered camera simultaneously. Selecting a feed
 * (click, or Enter/Space when focused) promotes it to a large primary view
 * with the rest as a thumbnail strip; selecting the primary feed again
 * returns to the grid. Layout changes use the same 180ms transition as feed
 * selection (design(1).md §25) -- no other animation.
 */
export function CameraWall({ cameras }: CameraWallProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = (cameraId: string): void => {
    setSelectedId((current) => (current === cameraId ? null : cameraId));
  };

  const selectedCamera = useMemo(() => cameras.find((c) => c.id === selectedId) ?? null, [cameras, selectedId]);
  const thumbnails = useMemo(() => cameras.filter((c) => c.id !== selectedId), [cameras, selectedId]);

  if (cameras.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-[#706E68]">
        No cameras registered
      </div>
    );
  }

  if (selectedCamera) {
    return (
      <div className="flex h-full w-full flex-col gap-3 p-4">
        <div className="min-h-0 flex-1 transition-all duration-[180ms] ease-out">
          <CameraFeed camera={selectedCamera} onSelect={handleSelect} />
        </div>
        <div className="flex h-28 shrink-0 gap-2 overflow-x-auto transition-all duration-[180ms] ease-out">
          {thumbnails.map((camera) => (
            <div key={camera.id} className="h-full w-40 shrink-0">
              <CameraFeed camera={camera} onSelect={handleSelect} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="grid h-full w-full auto-rows-fr gap-3 p-4 transition-all duration-[180ms] ease-out"
      style={{ gridTemplateColumns: `repeat(${gridColumns(cameras.length)}, minmax(0, 1fr))` }}
    >
      {cameras.map((camera) => (
        <CameraFeed key={camera.id} camera={camera} onSelect={handleSelect} />
      ))}
    </div>
  );
}
