import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { leaveTypeLabel } from "@/lib/i18n/labels";
import { User } from "@/lib/types";

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

  if (hasPermission(user, "leaves")) {
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

  if (hasPermission(user, "overtime")) {
    const where = { status: "pending" as const, ...employeeScope };
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

  if (user.role === "admin") {
    const where = { status: "pending" as const };
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

  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { items, pendingCount };
}
