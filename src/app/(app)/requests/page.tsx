import { prisma } from "@/lib/prisma";
import { requireAccess } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { getT } from "@/lib/i18n";
import { canApprove, hasPermission, isSelfService } from "@/lib/permissions";
import { employeesInScope, viewerScope } from "@/lib/scope";
import { dayStr } from "@/lib/serialize";
import { visibleWorkRequests, type WorkRequestRow } from "@/lib/work-requests";
import { PageHeader } from "@/components/shared/page-header";
import { WorkRequestsView, WorkRequestDialog } from "@/components/requests/work-requests-view";

/**
 * الطلبات: requests ("سهر" or anything else) a supervisor or HR files for workers of their department, approved
 * or rejected by the system admin or HR. A record only — no attendance, overtime or pay changes.
 */
export default async function RequestsPage() {
  const user = await requireAccess("/requests");
  const [t, db] = await Promise.all([getT(), getDb()]);
  const scope = viewerScope(user, db.employees);

  const rows = await prisma.workRequest.findMany({ orderBy: [{ createdAt: "desc" }] });
  const requests: WorkRequestRow[] = visibleWorkRequests(
    rows.map((r) => ({
      id: r.id,
      type: r.type,
      date: dayStr(r.date),
      fromTime: r.fromTime,
      toTime: r.toTime,
      details: r.details,
      employeeIds: Array.isArray(r.employeeIds) ? (r.employeeIds as string[]) : [],
      status: r.status,
      requestedById: r.requestedById,
      requestedBy: r.requestedBy,
      decidedBy: r.decidedBy,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
    })),
    user,
    scope,
  );

  // who can be named on a new request: the viewer's own workers, still working here (archive = terminated)
  const choosable = employeesInScope(scope, db.employees)
    .filter((e) => e.status !== "terminated")
    .map((e) => ({ value: e.id, label: `${e.name} — ${e.employeeNumber}` }));
  const names = Object.fromEntries(db.employees.map((e) => [e.id, e.name]));
  const canSubmit = !isSelfService(user) && hasPermission(user, "requests");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.workRequests.title}
        description={t.workRequests.description}
        actions={canSubmit ? <WorkRequestDialog employees={choosable} /> : null}
      />
      <WorkRequestsView requests={requests} names={names} canDecide={canApprove(user, "requests")} />
    </div>
  );
}
