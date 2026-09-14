interface FeedStatusBarProps {
  code: string;
  declaredStartTs: string;
  effectiveFps: number | null;
  belowQualityFloor: boolean;
}

// Warning band per design(1).md §3.2/§3.3: "status should use both color
// and text/icon, never rely on color alone" -- the tile border (see
// CameraFeed) is the color, this label is the text.
export function FeedStatusBar({
  code,
  declaredStartTs,
  effectiveFps,
  belowQualityFloor,
}: FeedStatusBarProps): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-[#30302D] bg-[#1B1B19] px-2 py-1 text-[11px]">
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-medium text-[#E8E5DD]">{code}</span>
        <span className="truncate text-[#706E68]">{declaredStartTs}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[#A5A29A]">{effectiveFps !== null ? `${effectiveFps.toFixed(1)} FPS` : "-- FPS"}</span>
        {belowQualityFloor && (
          <span className="rounded-sm border border-[#C9A653] px-1 py-0.5 font-semibold text-[#C9A653]">
            FPS WARNING
          </span>
        )}
      </div>
    </div>
  );
}
