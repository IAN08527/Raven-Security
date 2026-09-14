import type { ReidCandidate } from "../../types/api";
import { CandidateCard } from "./CandidateCard";

interface CandidateReviewPanelProps {
  targetId: string | null;
  candidates: ReidCandidate[];
  sourceCropUrl: string | null;
  cameraLabelFor: (cameraId: string) => string;
  serverBase: string;
  sessionToken: string;
  onDecided: (candidate: ReidCandidate) => void;
}

/**
 * M2-T5. Proposed candidates for the active target. Confirmed and
 * rejected rows remain visible with their badges (FR-5.7 audit
 * evidence) -- filtering them out would hide the decision record.
 */
export function CandidateReviewPanel({
  targetId,
  candidates,
  sourceCropUrl,
  cameraLabelFor,
  serverBase,
  sessionToken,
  onDecided,
}: CandidateReviewPanelProps): JSX.Element {
  const forTarget = targetId === null ? candidates : candidates.filter((c) => c.target_id === targetId);
  if (forTarget.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4 text-sm text-[#706E68]">
        No candidates proposed for this target
      </div>
    );
  }
  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto p-4">
      {forTarget.map((candidate) => (
        <CandidateCard
          key={candidate.id}
          candidate={candidate}
          sourceCropUrl={sourceCropUrl}
          cameraLabel={cameraLabelFor(candidate.camera_id)}
          serverBase={serverBase}
          sessionToken={sessionToken}
          onDecided={onDecided}
        />
      ))}
    </div>
  );
}
