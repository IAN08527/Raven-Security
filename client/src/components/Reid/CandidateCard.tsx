import { useState } from "react";
import type { ReidCandidate } from "../../types/api";
import { decideCandidate } from "../../lib/reidSocket";
import { formatPriorText } from "./priorText";

interface CandidateCardProps {
  candidate: ReidCandidate;
  sourceCropUrl: string | null;
  cameraLabel: string;
  serverBase: string;
  sessionToken: string;
  onDecided: (candidate: ReidCandidate) => void;
}

function badgeClass(status: ReidCandidate["status"]): string {
  // Design system §25: the badge state change uses a 180ms transition.
  // Nothing else on this card animates.
  const base = "inline-block rounded-sm px-1.5 py-0.5 text-xs font-semibold transition-all duration-[180ms] ease-out";
  if (status === "confirmed") return `${base} bg-[#1E3A24] text-[#7BC98A] border border-[#7BC98A]`;
  if (status === "rejected") return `${base} bg-[#262624] text-[#8A8880] border border-[#4A4945]`;
  return `${base} bg-[#2A2415] text-[#C9A653] border border-[#C9A653]`;
}

/**
 * M2-T5, FR-5.6/FR-5.7. One proposed sighting with its explanation:
 * similarity, threshold, topology prior in words, both crops, case-clock
 * time. Confirm and Reject each take a single deliberate click -- no
 * double-confirm, no auto-timeout. Decided rows stay rendered with their
 * badge (audit evidence), never hidden.
 */
export function CandidateCard({
  candidate,
  sourceCropUrl,
  cameraLabel,
  serverBase,
  sessionToken,
  onDecided,
}: CandidateCardProps): JSX.Element {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = (decision: "confirmed" | "rejected"): void => {
    if (pending || candidate.status !== "proposed") return;
    setPending(true);
    setError(null);
    decideCandidate(serverBase, sessionToken, candidate.id, decision)
      .then((result) => {
        onDecided({ ...candidate, status: result.status as ReidCandidate["status"] });
      })
      .catch(() => {
        setError("Decision failed — retry.");
      })
      .finally(() => {
        setPending(false);
      });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-[#30302D] bg-[#1B1B19] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className={badgeClass(candidate.status)}>{candidate.status}</span>
        <span className="truncate text-[11px] text-[#706E68]">{candidate.ts}</span>
      </div>
      <div className="flex gap-2">
        <div className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-black">
          {sourceCropUrl ? (
            <img src={sourceCropUrl} alt="Lock-on source crop" className="h-full w-full object-cover" />
          ) : (
            <span className="px-1 text-center text-[10px] text-[#706E68]">source crop</span>
          )}
        </div>
        <div className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-black">
          {candidate.crop_path ? (
            <img src={candidate.crop_path} alt="Candidate crop" className="h-full w-full object-cover" />
          ) : (
            <span className="px-1 text-center text-[10px] text-[#706E68]">candidate crop</span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
          <span className="text-[#E8E5DD]">
            similarity {candidate.similarity.toFixed(3)} / threshold {candidate.threshold_used.toFixed(3)}
          </span>
          <span className="text-[#A5A29A]">{formatPriorText(candidate.expected_window, candidate.ts, candidate.prior_adjustment)}</span>
          <span className="truncate text-[#706E68]">{cameraLabel}</span>
        </div>
      </div>
      {candidate.status === "proposed" ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => decide("confirmed")}
            className="rounded-sm bg-[#1E3A24] px-3 py-1 text-xs font-semibold text-[#7BC98A] disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => decide("rejected")}
            className="rounded-sm bg-[#262624] px-3 py-1 text-xs font-semibold text-[#A5A29A] disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      ) : null}
      {error ? <span className="text-xs text-[#C96A5A]">{error}</span> : null}
    </div>
  );
}
