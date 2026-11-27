import { prisma } from "@/lib/prisma";
import { HR_APPROVALS, canApprove, canReviewRequest, hasPermission, reviewsRequests } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { leaveTypeLabel } from "@/lib/i18n/labels";
import { User } from "@/lib/types";
import { canSeeMissingPunchReview, loadMissingPunchReview } from "@/lib/missing-punch-review";
import { canSeeOverdueReturn, loadOverdueReturns } from "@/lib/overdue-return";
import { canSeeAbsenceCheck, loadAbsenceCheckDays } from "@/lib/absence-check";

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  /** ISO timestamp the event happened. */
  at: string;
  href: string;
  /** Waiting on this user to act — stays counted until they do. Otherwise it's an FYI that counts until seen. */
  actionable: boolean;
  tone: "info" | "success" | "danger";
  /** A second, optional link shown alongside the first (e.g. straight to the employee's own profile page). */
  secondaryHref?: string;
  secondaryLabel?: string;
}

export interface NotificationFeed {
  items: AppNotification[];
  /** Total actionable items waiting on this user (not capped by the list length). */
  pendingCount: number;
}

const PER_KIND = 5;
const DECISION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * What the bell shows for this user — derived from live data, nothing stored:
 *  - things waiting on them: pending leaves / overtime (if they hold that
 *    permission, within their department scope) and, for an admin, pending
 *    change requests;
 *  - outcomes of their own requests: leave decisions and change-request
 *    approvals/rejections from the last 14 days.
 */
export async function getNotifications(user: User): Promise<NotificationFeed> {
  const t = await getT();
  const items: AppNotification[] = [];
  let pendingCount = 0;

  const deptIds = user.departmentIds ?? [];
  const employeeScope = deptIds.length > 0 ? { employee: { departmentId: { in: deptIds } } } : {};

  // a leave waits on whoever decides it: the admin or HR (with "leaves")
  if (canApprove(user, "leaves")) {
    const where = { status: "pending" as const, ...employeeScope };
    const [count, rows] = await Promise.all([
      prisma.leave.count({ where }),
      prisma.leave.findMany({ where, include: { employee: true }, orderBy: { createdAt: "desc" }, take: PER_KIND }),
    ]);
    pendingCount += count;
    for (const l of rows) {
      items.push({
        id: `leave-pending-${l.id}`,
        title: t.notifications.leavePending,
        body: `${l.employee.name} — ${leaveTypeLabel(l.type, t)} — ${isoDay(l.from)} → ${isoDay(l.to)}`,
        at: l.createdAt.toISOString(),
        href: "/leaves",
        actionable: true,
        tone: "info",
      });
    }
  }

  // a day a punch was forgotten on waits for a person to look at it (a list only: nothing is charged by guessing)
  if (canSeeMissingPunchReview(user)) {
    const days = await loadMissingPunchReview(user);
    pendingCount += days.length;
    const reasonLabel = { missing_punch: t.notifications.punchReviewMissing, odd_punches: t.notifications.punchReviewOdd, permission_unused: t.notifications.punchReviewPermission, permission_no_return: t.notifications.punchReviewNoReturn };
    for (const d of days.slice(0, PER_KIND)) {
      items.push({
        id: `punch-review-${d.employeeId}-${d.date}`,
        title: t.notifications.punchReview,
        body: `${d.name} — ${d.date} — ${reasonLabel[d.reason]}`,
        at: new Date(`${d.date}T12:00:00.000Z`).toISOString(),
        href: `/attendance?date=${d.date}`,
        actionable: true,
        tone: "info",
      });
    }
  }

  // an absent day with no approved leave/mission/excuse and not yet reviewed by HR ("is he really absent, or is it a
  // fingerprint problem?"); it never changes the day, a deduction or anyone's employment — see absence-check.ts
  if (canSeeAbsenceCheck(user)) {
    const days = await loadAbsenceCheckDays(user);
    pendingCount += days.length;
    for (const d of days.slice(0, PER_KIND)) {
      items.push({
        id: `absence-check-${d.employeeId}-${d.date}`,
        title: t.notifications.absenceCheck,
        body: `${d.name} — ${d.date} — ${t.notifications.absenceCheckNote}`,
        at: new Date(`${d.date}T12:00:00.000Z`).toISOString(),
        href: `/attendance?date=${d.date}`,
        actionable: true,
        tone: "info",
        secondaryHref: `/employees/${d.employeeId}`,
        secondaryLabel: t.notifications.absenceCheckProfileLink,
      });
    }
  }

  // an approved timed permission has ended and the employee has not punched back in: informational, a separate group
  // (never counted as pending work, never blocks anything)
  if (canSeeOverdueReturn(user)) {
    for (const o of (await loadOverdueReturns(user)).slice(0, PER_KIND)) {
      items.push({
        id: `overdue-return-${o.employeeId}-${o.date}`,
        title: t.notifications.overdueReturn,
        body: `${o.name} — ${t.notifications.overdueReturnUntil} ${o.permissionEnd}`,
        at: o.exitAt.toISOString(),
        href: `/attendance?date=${o.date}`,
        actionable: false,
        tone: "info",
      });
    }
  }

  if (hasPermission(user, "overtime")) {
    // a removed (voided) addition waits on nobody
    const where = { status: "pending" as const, voidedAt: null, ...employeeScope };
    const [count, rows] = await Promise.all([
      prisma.overtime.count({ where }),
      prisma.overtime.findMany({ where, include: { employee: true }, orderBy: { createdAt: "desc" }, take: PER_KIND }),
    ]);
    pendingCount += count;
    for (const o of rows) {
      items.push({
        id: `overtime-pending-${o.id}`,
        title: t.notifications.overtimePending,
        body: `${o.employee.name} — ${o.hours} ${t.notifications.hours} — ${isoDay(o.date)}`,
        at: o.createdAt.toISOString(),
        href: "/overtime",
        actionable: true,
        tone: "info",
      });
    }
  }

  if (reviewsRequests(user)) {
    // the admin: every pending request; HR: the leave decisions and deductions it approves
    const keys = user.role === "admin" ? null : Object.keys(HR_APPROVALS).filter((k) => canReviewRequest(user, k));
    const where = { status: "pending" as const, ...(keys ? { actionKey: { in: keys } } : {}) };
    const [count, rows] = await Promise.all([
      prisma.changeRequest.count({ where }),
      prisma.changeRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: PER_KIND }),
    ]);
    pendingCount += count;
    for (const c of rows) {
      items.push({
        id: `change-pending-${c.id}`,
        title: t.notifications.changePending,
        body: `${c.requestedBy} — ${c.actionLabel}`,
        at: c.createdAt.toISOString(),
        href: "/change-requests",
        actionable: true,
        tone: "info",
      });
    }
  }

  const since = new Date(Date.now() - DECISION_WINDOW_MS);

  if (user.employeeId) {
    const decided = await prisma.leave.findMany({
      where: { employeeId: user.employeeId, status: { in: ["approved", "rejected"] }, updatedAt: { gte: since } },
      orderBy: { updatedAt: "desc" },
      take: PER_KIND,
    });
    for (const l of decided) {
      const approved = l.status === "approved";
      items.push({
        id: `leave-decided-${l.id}-${l.status}`,
        title: approved ? t.notifications.leaveApproved : t.notifications.leaveRejected,
        body: `${leaveTypeLabel(l.type, t)} — ${isoDay(l.from)} → ${isoDay(l.to)}`,
        at: l.updatedAt.toISOString(),
        href: "/leaves",
        actionable: false,
        tone: approved ? "success" : "danger",
      });
    }
  }

  if (user.role !== "admin") {
    const reviewed = await prisma.changeRequest.findMany({
      where: {
        requestedById: user.id,
        direct: false,
        status: { in: ["approved", "rejected"] },
        reviewedAt: { gte: since },
      },
      orderBy: { reviewedAt: "desc" },
      take: PER_KIND,
    });
    for (const c of reviewed) {
      const approved = c.status === "approved";
      items.push({
        id: `change-decided-${c.id}-${c.status}`,
        title: approved ? t.notifications.changeApproved : t.notifications.changeRejected,
        body: `${c.actionLabel}${!approved && c.reviewNote ? ` — ${c.reviewNote}` : ""}`,
        at: (c.reviewedAt ?? c.createdAt).toISOString(),
        href: "/dashboard",
        actionable: false,
        tone: approved ? "success" : "danger",
      });
    }
  }

  // work requests ("سهر" and others): pending ones wait on the admin / HR (within its departments); whoever filed
  // one hears the decision
  if (canApprove(user, "requests")) {
    const rows = await prisma.workRequest.findMany({ where: { status: "pending" }, orderBy: { createdAt: "desc" } });
    const inDepts =
      user.role === "admin" || deptIds.length === 0
        ? null
        : new Set((await prisma.employee.findMany({ where: { departmentId: { in: deptIds } }, select: { id: true } })).map((e) => e.id));
    const waiting = rows.filter((r) => !inDepts || (Array.isArray(r.employeeIds) && (r.employeeIds as string[]).some((id) => inDepts.has(id))));
    pendingCount += waiting.length;
    for (const r of waiting.slice(0, PER_KIND)) {
      items.push({
        id: `work-request-pending-${r.id}`,
        title: t.notifications.workRequestPending,
        body: `${r.requestedBy} — ${r.details.slice(0, 80)}`,
        at: r.createdAt.toISOString(),
        href: "/requests",
        actionable: true,
        tone: "info",
      });
    }
  }
  const decidedRequests = await prisma.workRequest.findMany({
    where: { requestedById: user.id, status: { in: ["approved", "rejected"] }, decidedAt: { gte: since } },
    orderBy: { decidedAt: "desc" },
    take: PER_KIND,
  });
  for (const r of decidedRequests) {
    const approved = r.status === "approved";
    items.push({
      id: `work-request-decided-${r.id}-${r.status}`,
      title: approved ? t.notifications.workRequestApproved : t.notifications.workRequestRejected,
      body: `${r.details.slice(0, 80)}${!approved && r.decisionNote ? ` — ${r.decisionNote}` : ""}`,
      at: (r.decidedAt ?? r.createdAt).toISOString(),
      href: "/requests",
      actionable: false,
      tone: approved ? "success" : "danger",
    });
  }

  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { items, pendingCount };
}
