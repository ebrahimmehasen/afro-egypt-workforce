import { inScope, type Scope } from "@/lib/scope";

export interface WorkRequestRow {
  id: string;
  type: "late_work" | "other";
  date: string;
  fromTime: string | null;
  toTime: string | null;
  details: string;
  employeeIds: string[];
  status: "pending" | "approved" | "rejected";
  requestedById: string;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

/**
 * The requests a viewer sees on /requests: all of them company-wide; within a department scope, the ones they
 * filed plus any naming one of their workers.
 */
export function visibleWorkRequests(requests: WorkRequestRow[], viewer: { id: string }, scope: Scope): WorkRequestRow[] {
  if (scope.all) return requests;
  return requests.filter((r) => r.requestedById === viewer.id || r.employeeIds.some((id) => inScope(scope, id)));
}
