interface LostBannerProps {
  cameraLabel: string;
  lastSeenTs: string;
  widenActive: boolean;
  onWiden: () => void;
  onDismiss: () => void;
}

/**
 * M2-T5, FR-5.8. Loss is stated, never silent: the banner names the
 * camera and the last case-clock sighting, and stays until the operator
 * explicitly dismisses it or a new candidate arrives. "Widen search"
 * lowers the threshold by 0.05 for 60 seconds (logged as an audit event
 * by the caller).
 */
export function LostBanner({ cameraLabel, lastSeenTs, widenActive, onWiden, onDismiss }: LostBannerProps): JSX.Element {
  return (
    <div className="flex w-full flex-col gap-2 rounded-md border border-[#C9A653] bg-[#2A2415] p-3">
      <span className="text-sm font-semibold text-[#E8E5DD]">
        TARGET LOST at {cameraLabel} — last seen {lastSeenTs}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={widenActive}
          onClick={onWiden}
          className="rounded-sm bg-[#3A3220] px-3 py-1 text-xs font-semibold text-[#C9A653] disabled:opacity-50"
        >
          {widenActive ? "Search widened (60s)" : "Widen search"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-sm bg-transparent px-3 py-1 text-xs font-semibold text-[#A5A29A]"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
