import { describe, expect, it } from "vitest";
import type { Store } from "@/lib/store";
import type { ToolContext } from "@/lib/assistant/employee-tools";
import type { AdminExtras } from "@/lib/assistant/admin-tools";
import { runTool } from "@/lib/assistant/tools";
import { ctx as base, store } from "./helpers/assistant-fixture";

// "today" in the fixture is 2026-09-20
const db = {
  ...store,
  leaves: [
    ...store.leaves,
    { id: "l2", employeeId: "secret-id-2", type: "sick", from: "2026-09-21", to: "2026-09-23", reason: "إجازة مرضية", status: "pending", createdAt: "2026-09-19T08:00:00.000Z" },
    { id: "l3", employeeId: "secret-id-2", type: "annual", from: "2026-08-01", to: "2026-08-02", reason: "قديمة", status: "approved", createdAt: "2026-07-30T08:00:00.000Z" },
  ],
  overtime: [...store.overtime, { id: "o2", employeeId: "secret-id-2", date: "2026-09-12", hours: 2, amount: 80, status: "pending", kind: "overtime" }],
  companySettings: { companyName: "أفرو إيجيبت", logoUrl: "", address: "القاهرة", phone: "0100" },
  attendanceSettings: { defaultGracePeriodMinutes: 10, lateDeductionPerMinute: 5, earlyLeaveDeductionPerMinute: 5, absenceDeductionDays: 1, weeklyOffDays: "5" },
  payrollSettings: { overtimeHourlyMultiplier: 1.5, workingDaysPerMonth: 26, workingHoursPerDay: 8, payPeriodStartDay: 26 },
} as unknown as Store;

const extras: AdminExtras = {
  changeRequests: [
    { requestedBy: "منى HR", module: "الموظفين", actionLabel: "تعديل موظف", summary: "المرتب 3000 ← 3500", payload: { basicSalary: 3500 }, status: "pending", direct: false, reviewedBy: null, reviewNote: null, createdAt: "2026-09-19T09:00:00.000Z", reviewedAt: null },
    { requestedBy: "منى HR", module: "الخصومات", actionLabel: "إضافة خصم", summary: "خصم 50", payload: {}, status: "approved", direct: false, reviewedBy: "الأدمن", reviewNote: "تمام", createdAt: "2026-09-10T09:00:00.000Z", reviewedAt: "2026-09-10T10:00:00.000Z" },
  ],
  workRequests: [
    { type: "late_work", date: "2026-09-24", fromTime: "18:00", toTime: "22:00", details: "سهر لشحنة", employeeIds: ["secret-id-2"], status: "pending", requestedBy: "مشرف الإنتاج", decidedBy: null, decisionNote: null, createdAt: "2026-09-19T10:00:00.000Z" },
  ],
  auditLog: [
    { userName: "الأدمن", action: "تعديل حضور", module: "الحضور والانصراف", oldValue: "غياب", newValue: "حضور", reason: "نسيان البصمة", timestamp: "2026-09-18T07:00:00.000Z" },
    { userName: "منى HR", action: "إضافة موظف", module: "الموظفين", oldValue: "-", newValue: "موظف جديد", reason: null, timestamp: "2026-09-01T07:00:00.000Z" },
  ],
  users: [
    { name: "الأدمن", email: "admin@x.com", role: "admin", active: true, permissions: [], directEdit: false, employeeId: null, departmentIds: [], lastLoginAt: "2026-09-19T06:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" },
    { name: "منى HR", email: "mona@x.com", role: "staff", active: true, permissions: ["/employees", "/leaves"], directEdit: true, employeeId: null, departmentIds: ["d-prod"], lastLoginAt: null, createdAt: "2026-02-01T00:00:00.000Z" },
  ],
  holidays: [{ name: "عيد", from: "2026-09-30", to: "2026-10-02" }],
  devices: [{ name: "بصمة المصنع", location: "البوابة", active: true }],
  biometric: { ip: "192.168.1.201", port: 4370 },
};

const ctx: ToolContext = { ...base, db, extras };
const run = (name: string, args: unknown = {}, c: ToolContext = ctx) => runTool(name, args, c) as Record<string, any>;
const text = (v: unknown) => JSON.stringify(v);

describe("pending_approvals", () => {
  it("gathers everything waiting for a decision, with names and details", () => {
    const r = run("pending_approvals");
    expect(r.counts).toEqual({ leaves: 1, overtime: 1, changeRequests: 1, workRequests: 1, total: 4 });
    expect(r.leaves[0]).toMatchObject({ days: 3, from: "2026-09-21", reason: "إجازة مرضية" });
    expect(r.overtime[0]).toMatchObject({ hours: 2, amount: 80 });
    expect(r.changeRequests[0]).toMatchObject({ requestedBy: "منى HR", action: "تعديل موظف", summary: "المرتب 3000 ← 3500" });
    expect(r.workRequests[0]).toMatchObject({ day: "2026-09-24", from: "18:00", askedBy: "مشرف الإنتاج" });
    expect(r.workRequests[0].workers).toHaveLength(1);
  });

  it("never exposes an internal id", () => {
    expect(text(run("pending_approvals"))).not.toContain("secret-id");
  });

  it("says so when the extra data could not be loaded", () => {
    expect(run("pending_approvals", {}, { ...base, db }).error).toMatch(/not available/);
  });
});

describe("change_requests and work_requests", () => {
  it("filters by status and requester", () => {
    expect(run("change_requests", { status: "approved" }).requests).toHaveLength(1);
    expect(run("change_requests", { requested_by: "منى" }).total).toBe(2);
    expect(run("change_requests", { text: "الخصومات" }).requests[0].decisionNote).toBe("تمام");
  });

  it("filters work requests by period", () => {
    expect(run("work_requests", { from: "2026-09-25" }).total).toBe(0);
    expect(run("work_requests", { from: "2026-09-20", to: "2026-09-30" }).total).toBe(1);
  });
});

describe("audit_log", () => {
  it("filters by person, page, word and period", () => {
    expect(run("audit_log").total).toBe(2);
    expect(run("audit_log", { user: "منى" }).entries[0].action).toBe("إضافة موظف");
    expect(run("audit_log", { text: "البصمة" }).entries[0]).toMatchObject({ who: "الأدمن", reason: "نسيان البصمة" });
    expect(run("audit_log", { from: "2026-09-10" }).total).toBe(1);
  });

  it("shows times in Cairo time", () => {
    expect(run("audit_log", { user: "الأدمن" }).entries[0].when).toBe("2026-09-18 10:00");
  });
});

describe("users_and_permissions and settings_overview", () => {
  it("lists accounts without any secret", () => {
    const r = run("users_and_permissions");
    expect(r.total).toBe(2);
    expect(r.accounts[0]).toMatchObject({ name: "الأدمن", pages: "all" });
    expect(r.accounts[1]).toMatchObject({ pages: ["/employees", "/leaves"], mayActWithoutApproval: true });
    expect(text(r)).not.toMatch(/passwordHash|apiKey/i);
    expect(run("users_and_permissions", { role: "admin" }).total).toBe(1);
  });

  it("reports the settings, holidays and devices", () => {
    const r = run("settings_overview");
    expect(r.holidays).toEqual([{ name: "عيد", from: "2026-09-30", to: "2026-10-02" }]);
    expect(r.fingerprintDevices).toEqual([{ name: "بصمة المصنع", location: "البوابة", active: true }]);
    expect(r.attendance.weeklyDaysOff.length).toBeGreaterThan(0);
    expect(text(r)).not.toMatch(/commPassword/i);
  });
});
