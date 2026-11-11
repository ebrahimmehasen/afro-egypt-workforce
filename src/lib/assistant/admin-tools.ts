import type { ToolContext } from "@/lib/assistant/employee-tools";
import { deptName } from "@/lib/assistant/employee-tools";
import { MAX_ROWS, byId, clip, isDay, str, tally } from "@/lib/assistant/system-tools";
import { leaveTypeLabel, overtimeKindLabel, requestStatusLabel } from "@/lib/i18n/labels";

// The admin-only part of the assistant's reading: everything the admin pages show that is not in the main
// Store, namely the requests waiting for a decision, the audit trail, the accounts and their permissions, the
// company and attendance settings, holidays and the fingerprint devices. Read-only like every other tool, and
// never a password hash, a device key or the device's communication password.

/** Loaded by the tool endpoint, already trimmed to plain values. Nothing here is a secret. */
export interface AdminExtras {
  changeRequests: {
    requestedBy: string;
    module: string;
    actionLabel: string;
    summary: string;
    payload: unknown;
    status: string;
    direct: boolean;
    reviewedBy: string | null;
    reviewNote: string | null;
    createdAt: string;
    reviewedAt: string | null;
  }[];
  workRequests: {
    type: string;
    date: string;
    fromTime: string | null;
    toTime: string | null;
    details: string;
    employeeIds: string[];
    status: string;
    requestedBy: string;
    decidedBy: string | null;
    decisionNote: string | null;
    createdAt: string;
  }[];
  auditLog: { userName: string; action: string; module: string; oldValue: string; newValue: string; reason: string | null; timestamp: string }[];
  users: {
    name: string;
    email: string;
    role: string;
    active: boolean;
    permissions: string[];
    directEdit: boolean;
    employeeId: string | null;
    departmentIds: string[];
    lastLoginAt: string | null;
    createdAt: string;
  }[];
  holidays: { name: string; from: string; to: string }[];
  devices: { name: string; location: string | null; active: boolean }[];
  biometric: { ip: string; port: number } | null;
}

const STATUS = ["pending", "approved", "rejected"];
const statusProp = { type: "string", enum: STATUS } as const;
const limitProp = { type: "integer", description: `How many to list (default 20, at most ${MAX_ROWS * 2}).` } as const;

export const ADMIN_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "pending_approvals",
      description:
        "Everything waiting for the admin's decision, in one place: leave requests, overtime, changes requested by HR and supervisors, and work requests (like staying late). Counts and the full details of each. Use it for 'what is pending', 'what needs my approval'.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "change_requests",
      description:
        "Changes that HR or supervisors asked to make (add or edit an employee, delete, approvals…) and the ones they made directly: who asked, what, the old and new values, the decision and the note. Newest first.",
      parameters: {
        type: "object",
        properties: {
          status: statusProp,
          requested_by: { type: "string", description: "Part of the requester's name." },
          text: { type: "string", description: "A word to look for in the module, the action or the summary." },
          limit: limitProp,
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "work_requests",
      description:
        "Work requests supervisors and HR filed for workers (staying late, or anything else): the day, the hours, the details, which workers, who asked, and the decision. Newest first.",
      parameters: {
        type: "object",
        properties: {
          status: statusProp,
          from: { type: "string", description: "First day, yyyy-MM-dd." },
          to: { type: "string", description: "Last day, yyyy-MM-dd." },
          limit: limitProp,
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "audit_log",
      description:
        "The audit trail: who did what, where and when, with the old and new values and the reason. Filter by person, page, a word or a period. Newest first; only the latest few hundred entries are available.",
      parameters: {
        type: "object",
        properties: {
          user: { type: "string", description: "Part of the name of who did it." },
          module: { type: "string", description: "Part of the module or page name." },
          text: { type: "string", description: "A word to look for in the action, the values or the reason." },
          from: { type: "string", description: "First day, yyyy-MM-dd." },
          to: { type: "string", description: "Last day, yyyy-MM-dd." },
          limit: limitProp,
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "users_and_permissions",
      description:
        "The system accounts: name, e-mail, role, whether active, last login, which pages each administrative account may open, whether it may act without approval, and the departments it covers.",
      parameters: { type: "object", properties: { role: { type: "string", enum: ["admin", "hr", "supervisor", "staff", "employee"] } } },
    },
  },
  {
    type: "function",
    function: {
      name: "settings_overview",
      description:
        "The company's settings: company details, attendance rules (grace period, late and absence deduction rates, weekly day off), pay rules (overtime multiplier, working days and hours, pay period start day), the holidays and the fingerprint devices.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

export type AdminToolName = (typeof ADMIN_TOOL_DEFINITIONS)[number]["function"]["name"];

const MISSING = { error: "This information is not available right now." };

const cairoDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" });
const cairoTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false });
const dayOf = (iso: string) => cairoDay.format(new Date(iso));
const stamp = (iso: string | null | undefined) => (iso ? `${dayOf(iso)} ${cairoTime.format(new Date(iso))}` : null);
const limitOf = (a: Record<string, unknown>, fallback = 20) => Math.min(Math.max(Number(a.limit) || fallback, 1), MAX_ROWS * 2);
const has = (hay: string | null | undefined, needle: string | undefined) => !needle || (hay ?? "").toLowerCase().includes(needle.toLowerCase());
const asStatus = (v: unknown) => (typeof v === "string" && STATUS.includes(v) ? v : undefined);

const WORK_KIND: Record<"ar" | "en", Record<string, string>> = {
  ar: { late_work: "سهر", other: "طلب آخر" },
  en: { late_work: "Staying late", other: "Other request" },
};
const ROLE: Record<"ar" | "en", Record<string, string>> = {
  ar: { admin: "أدمن", hr: "موارد بشرية", supervisor: "مشرف", staff: "إداري", employee: "موظف" },
  en: { admin: "Admin", hr: "HR", supervisor: "Supervisor", staff: "Staff", employee: "Employee" },
};
const WEEKDAYS: Record<"ar" | "en", string[]> = {
  ar: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

/** A change request, for the admin: what was asked, and the values it carries (cut short). */
function changeRow(ctx: ToolContext, r: AdminExtras["changeRequests"][number]) {
  const payload = JSON.stringify(r.payload ?? null);
  return {
    requestedBy: r.requestedBy,
    module: r.module,
    action: r.actionLabel,
    summary: clip(r.summary, 400),
    values: payload.length > 700 ? `${payload.slice(0, 700)}…` : payload,
    status: requestStatusLabel(r.status as never, ctx.t),
    madeDirectly: r.direct,
    decidedBy: r.reviewedBy,
    decisionNote: r.reviewNote ? clip(r.reviewNote) : null,
    askedAt: stamp(r.createdAt),
    decidedAt: stamp(r.reviewedAt),
  };
}

function workRow(ctx: ToolContext, r: AdminExtras["workRequests"][number], names: Map<string, string>) {
  return {
    kind: WORK_KIND[ctx.locale][r.type] ?? r.type,
    day: r.date,
    from: r.fromTime,
    to: r.toTime,
    details: clip(r.details, 400),
    workers: r.employeeIds.map((id) => names.get(id)).filter(Boolean),
    askedBy: r.requestedBy,
    status: requestStatusLabel(r.status as never, ctx.t),
    decidedBy: r.decidedBy,
    decisionNote: r.decisionNote ? clip(r.decisionNote) : null,
    askedAt: stamp(r.createdAt),
  };
}

export function pendingApprovals(ctx: ToolContext) {
  const x = ctx.extras;
  if (!x) return MISSING;
  const people = byId(ctx);
  const names = new Map([...people].map(([id, e]) => [id, e.name]));
  const name = (id: string) => names.get(id) ?? "?";

  const leaves = ctx.db.leaves.filter((l) => l.status === "pending").sort((a, b) => (a.from < b.from ? -1 : 1));
  const overtime = ctx.db.overtime.filter((o) => o.status === "pending").sort((a, b) => (a.date < b.date ? -1 : 1));
  const changes = x.changeRequests.filter((r) => r.status === "pending");
  const work = x.workRequests.filter((r) => r.status === "pending");

  return {
    counts: { leaves: leaves.length, overtime: overtime.length, changeRequests: changes.length, workRequests: work.length, total: leaves.length + overtime.length + changes.length + work.length },
    leaves: leaves.slice(0, MAX_ROWS).map((l) => {
      const days = Math.round((Date.parse(`${l.to}T00:00:00Z`) - Date.parse(`${l.from}T00:00:00Z`)) / 86_400_000) + 1;
      const e = people.get(l.employeeId);
      return { employee: name(l.employeeId), department: e ? deptName(ctx, e) : null, type: leaveTypeLabel(l.type, ctx.t), from: l.from, to: l.to, days, reason: clip(l.reason), askedAt: stamp(l.createdAt) };
    }),
    overtime: overtime.slice(0, MAX_ROWS).map((o) => {
      const e = people.get(o.employeeId);
      return { employee: name(o.employeeId), department: e ? deptName(ctx, e) : null, day: o.date, hours: o.hours, amount: o.amount, kind: overtimeKindLabel(o.kind, ctx.t) };
    }),
    changeRequests: changes.slice(0, MAX_ROWS).map((r) => changeRow(ctx, r)),
    workRequests: work.slice(0, MAX_ROWS).map((r) => workRow(ctx, r, names)),
  };
}

export function changeRequests(ctx: ToolContext, a: Record<string, unknown>) {
  const x = ctx.extras;
  if (!x) return MISSING;
  const status = asStatus(a.status);
  const by = str(a.requested_by);
  const text = str(a.text);
  const rows = x.changeRequests
    .filter((r) => (!status || r.status === status) && has(r.requestedBy, by) && (!text || has(r.module, text) || has(r.actionLabel, text) || has(r.summary, text)))
    .sort((p, q) => (p.createdAt < q.createdAt ? 1 : -1));
  return {
    total: rows.length,
    byStatus: tally(rows, (r) => requestStatusLabel(r.status as never, ctx.t)),
    showing: Math.min(rows.length, limitOf(a)),
    requests: rows.slice(0, limitOf(a)).map((r) => changeRow(ctx, r)),
  };
}

export function workRequests(ctx: ToolContext, a: Record<string, unknown>) {
  const x = ctx.extras;
  if (!x) return MISSING;
  const status = asStatus(a.status);
  const names = new Map(ctx.db.employees.map((e) => [e.id, e.name]));
  const rows = x.workRequests
    .filter((r) => (!status || r.status === status) && (!isDay(a.from) || r.date >= a.from) && (!isDay(a.to) || r.date <= a.to))
    .sort((p, q) => (p.date < q.date ? 1 : -1));
  return {
    total: rows.length,
    byStatus: tally(rows, (r) => requestStatusLabel(r.status as never, ctx.t)),
    showing: Math.min(rows.length, limitOf(a)),
    requests: rows.slice(0, limitOf(a)).map((r) => workRow(ctx, r, names)),
  };
}

export function auditLog(ctx: ToolContext, a: Record<string, unknown>) {
  const x = ctx.extras;
  if (!x) return MISSING;
  const user = str(a.user);
  const mod = str(a.module);
  const text = str(a.text);
  const rows = x.auditLog.filter((e) => {
    const day = dayOf(e.timestamp);
    return (
      has(e.userName, user) &&
      has(e.module, mod) &&
      (!text || has(e.action, text) || has(e.oldValue, text) || has(e.newValue, text) || has(e.reason, text)) &&
      (!isDay(a.from) || day >= a.from) &&
      (!isDay(a.to) || day <= a.to)
    );
  });
  return {
    available: `the latest ${x.auditLog.length} entries`,
    total: rows.length,
    byUser: tally(rows, (e) => e.userName),
    byModule: tally(rows, (e) => e.module),
    showing: Math.min(rows.length, limitOf(a)),
    entries: rows.slice(0, limitOf(a)).map((e) => ({
      when: stamp(e.timestamp),
      who: e.userName,
      module: e.module,
      action: e.action,
      from: clip(e.oldValue, 160),
      to: clip(e.newValue, 160),
      reason: e.reason ? clip(e.reason) : null,
    })),
  };
}

export function usersAndPermissions(ctx: ToolContext, a: Record<string, unknown>) {
  const x = ctx.extras;
  if (!x) return MISSING;
  const role = str(a.role);
  const names = new Map(ctx.db.employees.map((e) => [e.id, e.name]));
  const departments = new Map(ctx.db.departments.map((d) => [d.id, d.name]));
  const rows = x.users.filter((u) => !role || u.role === role);
  return {
    total: rows.length,
    byRole: tally(rows, (u) => ROLE[ctx.locale][u.role] ?? u.role),
    inactive: rows.filter((u) => !u.active).length,
    accounts: rows.map((u) => ({
      name: u.name,
      email: u.email,
      role: ROLE[ctx.locale][u.role] ?? u.role,
      active: u.active,
      lastLogin: stamp(u.lastLoginAt),
      linkedEmployee: u.employeeId ? (names.get(u.employeeId) ?? null) : null,
      // an admin always has every page; the list matters for the administrative accounts
      pages: u.role === "admin" ? "all" : u.permissions,
      mayActWithoutApproval: u.directEdit,
      departments: u.departmentIds.length ? u.departmentIds.map((id) => departments.get(id)).filter(Boolean) : "all",
    })),
  };
}

export function settingsOverview(ctx: ToolContext) {
  const x = ctx.extras;
  if (!x) return MISSING;
  const { companySettings: c, attendanceSettings: at, payrollSettings: p } = ctx.db;
  const days = WEEKDAYS[ctx.locale];
  return {
    company: { name: c.companyName, address: c.address, phone: c.phone },
    attendance: {
      graceMinutes: at.defaultGracePeriodMinutes,
      lateDeductionPerMinute: at.lateDeductionPerMinute,
      earlyLeaveDeductionPerMinute: at.earlyLeaveDeductionPerMinute,
      absenceDeductionDays: at.absenceDeductionDays,
      weeklyDaysOff: String(at.weeklyOffDays)
        .split(",")
        .map((d) => days[Number(d)])
        .filter(Boolean),
    },
    pay: {
      overtimeMultiplier: p.overtimeHourlyMultiplier,
      workingDaysPerMonth: p.workingDaysPerMonth,
      workingHoursPerDay: p.workingHoursPerDay,
      payMonthStartsOnDay: p.payPeriodStartDay,
    },
    holidays: [...x.holidays].sort((l, r) => (l.from < r.from ? 1 : -1)).slice(0, 40),
    fingerprintDevices: x.devices,
    fingerprintDeviceAddress: x.biometric,
  };
}

/** Runs one of these tools, or returns undefined when the name isn't one of them. */
export function executeAdminTool(name: string, args: unknown, ctx: ToolContext): unknown {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  switch (name as AdminToolName) {
    case "pending_approvals":
      return pendingApprovals(ctx);
    case "change_requests":
      return changeRequests(ctx, a);
    case "work_requests":
      return workRequests(ctx, a);
    case "audit_log":
      return auditLog(ctx, a);
    case "users_and_permissions":
      return usersAndPermissions(ctx, a);
    case "settings_overview":
      return settingsOverview(ctx);
    default:
      return undefined;
  }
}

