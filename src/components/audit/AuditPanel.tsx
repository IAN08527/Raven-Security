import { useQuery } from "@tanstack/react-query";
import { invokeRaven } from "../../hooks/useInvoke";
import { useCaseStore } from "../../store/case";

export function AuditPanel() {
  const caseId = useCaseStore((s) => s.caseId);
  const { data } = useQuery({
    queryKey: ["audit", caseId],
    queryFn: () => invokeRaven<any[]>("get_audit_trail", { object_id: caseId }),
  });

  return (
    <div className="h-full overflow-y-auto bg-pd-base p-4">
      <h2 className="mb-3 text-pd-lg">Audit Ledger</h2>
      <table className="w-full text-pd-sm">
        <thead className="text-pd-text-secondary">
          <tr className="border-b border-pd-border">
            <th className="py-1 text-left">Action</th>
            <th className="py-1 text-left">Time</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((a) => (
            <tr key={a.id} className="border-b border-pd-border">
              <td className="py-1 font-mono text-pd-text-primary">{a.action}</td>
              <td className="py-1 font-mono text-pd-text-tertiary">{a.created_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
