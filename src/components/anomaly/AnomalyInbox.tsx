import { useQuery } from "@tanstack/react-query";
import { invokeRaven } from "../../hooks/useInvoke";
import { useCaseStore } from "../../store/case";

export function AnomalyInbox() {
  const caseId = useCaseStore((s) => s.caseId);
  const { data } = useQuery({
    queryKey: ["anomalies", caseId],
    queryFn: () => invokeRaven<any[]>("list_anomalies", { case_id: caseId }),
  });

  return (
    <div className="h-[140px] border-t border-pd-border bg-pd-surface">
      <div className="px-3 py-1 text-pd-sm text-pd-text-secondary">Anomaly Inbox</div>
      <div className="flex gap-2 overflow-x-auto px-3 pb-2">
        {(data ?? []).map((a, i) => (
          <div
            key={i}
            className="min-w-[180px] rounded-pd-sm border border-pd-border bg-pd-elevated p-2"
          >
            <div className="text-pd-sm text-pd-danger">{a.kind}</div>
            <div className="text-pd-xs text-pd-text-tertiary">sev {a.severity}</div>
          </div>
        ))}
        {!data?.length && (
          <div className="text-pd-xs text-pd-text-tertiary">No anomalies.</div>
        )}
      </div>
    </div>
  );
}
