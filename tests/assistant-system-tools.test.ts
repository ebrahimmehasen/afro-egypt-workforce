import { describe, expect, it } from "vitest";
import type { Store } from "@/lib/store";
import type { ToolContext } from "@/lib/assistant/employee-tools";
import { ALL_TOOL_DEFINITIONS, listTools, runTool } from "@/lib/assistant/tools";
import { ctx as base, store } from "./helpers/assistant-fixture";

// the fixture's "today" is 2026-09-20; these add a pending leave, a pending overtime request, a second payroll
// line and a department head on top of it
const db = {
  ...store,
  departments: [
    { id: "d-prod", name: "الإنتاج", managerName: "سامي تجريبي" },
    { id: "d-tbd", name: "غير محدد" },
  ],
  leaves: [
    ...store.leaves,
    { id: "l2", employeeId: "secret-id-2", type: "sick", from: "2026-09-21", to: "2026-09-23", reason: "إجازة مرضية", status: "pending" },
  ],
  overtime: [
    ...store.overtime,
    { id: "o2", employeeId: "secret-id-2", date: "2026-09-12", hours: 2, amount: 80, status: "pending", kind: "overtime" },
  ],
  payrollRecords: [
    ...store.payrollRecords,
    { id: "r2", periodId: "p1", employeeId: "secret-id-2", grossSalary: 3000, totalDeductions: 0, netSalary: 3000, overtimeAmount: 0 },
  ],
} as unknown as Store;
const ctx: ToolContext = { ...base, db };

const run = (name: string, args: unknown = {}) => runTool(name, args, ctx) as Record<string, any>;
const text = (v: unknown) => JSON.stringify(v);

describe("the tool registry", () => {
  it("lists every tool once, with a description and a JSON schema", () => {
    const tools = listTools();
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(["get_employee", "attendance_summary", "leaves_overview", "overtime_overview", "deductions_overview", "payroll_overview", "departments_and_shifts"]));
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(10);
      expect((t.inputSchema as { type: string }).type).toBe("object");
    }
    expect(ALL_TOOL_DEFINITIONS.length).toBe(tools.length);
  });

  it("only ever reads: no tool name suggests a write", () => {
    for (const t of listTools()) expect(t.name).not.toMatch(/^(create|add|update|edit|delete|remove|approve|reject|set|save|send)_/);
  });

  it("answers an unknown tool with an error the model can read", () => {
    expect(run("drop_database").error).toMatch(/Unknown tool/);
  });
});

describe("attendance_summary", () => {
  it("summarises one day by name, with the late minutes", () => {
    const r = run("attendance_summary", { date: "2026-09-19" });
    expect(r.recordsAnalysed).toBe(2);
    expect(r.byStatus).toEqual({ [ctxLabel("late")]: 1, [ctxLabel("absent")]: 1 });
    expect(r.late[0]).toMatchObject({ name: "سامي تجريبي", lateMinutes: 25 });
    expect(r.absent[0]).toMatchObject({ name: "سامي آخر" });
  });

  it("defaults to today", () => {
    expect(run("attendance_summary").period).toEqual({ from: "2026-09-20", to: "2026-09-20" });
  });

  it("gives one employee's days with times", () => {
    const r = run("attendance_summary", { employee: "PROD-001", from: "2026-09-01", to: "2026-09-20" });
    expect(r.employee.name).toBe("سامي تجريبي");
    expect(r.days).toHaveLength(2);
    expect(r.days[0].date).toBe("2026-09-19");
    expect(r.days[0].in).toMatch(/^\d\d:\d\d$/);
  });

  it("filters by department and finds nobody for an unknown one", () => {
    expect(run("attendance_summary", { date: "2026-09-19", department: "الإنتاج" }).recordsAnalysed).toBe(2);
    expect(run("attendance_summary", { date: "2026-09-19", department: "لا يوجد" }).recordsAnalysed).toBe(0);
  });

  it("does not guess when the employee is unknown or ambiguous", () => {
    expect(run("attendance_summary", { employee: "مجهول" }).found).toBe(false);
    expect(run("attendance_summary", { employee: "سامي" }).ambiguous).toBe(true);
  });

  it("ignores malformed dates instead of failing", () => {
    expect(run("attendance_summary", { date: "tomorrow-ish" }).period).toEqual({ from: "2026-09-20", to: "2026-09-20" });
  });
});

describe("leaves, overtime and deductions", () => {
  it("lists leaves in the window with their status and filters by it", () => {
    // by default: 30 days back to 60 ahead, so the August leave is out of it
    expect(run("leaves_overview").total).toBe(1);
    expect(run("leaves_overview", { from: "2026-07-01", to: "2026-12-31" }).total).toBe(2);
    const pending = run("leaves_overview", { status: "pending" });
    expect(pending.total).toBe(1);
    expect(pending.leaves[0]).toMatchObject({ name: "سامي آخر", from: "2026-09-21", days: 3 });
  });

  it("totals overtime by status and lists what waits for approval", () => {
    const r = run("overtime_overview", { from: "2026-09-01", to: "2026-09-20" });
    expect(r.requests).toBe(2);
    expect(r.waitingForApproval).toHaveLength(1);
    expect(r.waitingForApproval[0]).toMatchObject({ name: "سامي آخر", hours: 2 });
    expect(r.mostOvertime[0]).toMatchObject({ name: "سامي تجريبي", hours: 3 });
  });

  it("totals deductions by type", () => {
    const r = run("deductions_overview", { from: "2026-09-01", to: "2026-09-20" });
    expect(r.count).toBe(1);
    expect(r.totalAmount).toBe(100);
    expect(run("deductions_overview", { from: "2026-09-01", to: "2026-09-20", type: "late" }).count).toBe(0);
  });
});

describe("payroll_overview", () => {
  it("totals the latest period and groups by department", () => {
    const r = run("payroll_overview");
    expect(r.period).toBe("أغسطس 2026");
    expect(r.employees).toBe(2);
    expect(r.totals).toMatchObject({ gross: 8200, deductions: 100, net: 8100 });
    expect(r.byDepartment[0]).toMatchObject({ department: "الإنتاج", employees: 2 });
  });

  it("gives one person's pay line without internal ids", () => {
    const r = run("payroll_overview", { employee: "PROD-001" });
    expect(r.pay.netSalary).toBe(5100);
    expect(r.pay.id).toBeUndefined();
    expect(r.pay.employeeId).toBeUndefined();
  });

  it("says so for a month with no payroll", () => {
    expect(run("payroll_overview", { year: 2020, month: 1 }).found).toBe(false);
  });
});

describe("departments_and_shifts", () => {
  it("lists head counts, heads and shift times", () => {
    const r = run("departments_and_shifts");
    expect(r.departments.find((d: { name: string }) => d.name === "الإنتاج")).toMatchObject({ employees: 2, head: "سامي تجريبي" });
    expect(r.shifts[0]).toMatchObject({ name: "الصباحية", from: "08:00", to: "16:00" });
    expect(r.shifts[0].workDays[0]).toBe("الأحد");
  });
});

describe("what never reaches the model", () => {
  it("no tool result contains an internal id", () => {
    const calls: [string, unknown][] = [
      ["attendance_summary", { date: "2026-09-19" }],
      ["attendance_summary", { employee: "PROD-001", from: "2026-09-01" }],
      ["leaves_overview", {}],
      ["overtime_overview", { from: "2026-09-01" }],
      ["deductions_overview", { from: "2026-09-01" }],
      ["payroll_overview", {}],
      ["payroll_overview", { employee: "PROD-001" }],
      ["departments_and_shifts", {}],
    ];
    for (const [name, args] of calls) expect(text(run(name, args))).not.toContain("secret-id");
  });

  it("names people instead of numbering them", () => {
    // the two "سامي" employees have different full names, so no employee number is needed to tell them apart
    expect(text(run("attendance_summary", { date: "2026-09-19" }))).not.toContain("PROD-00");
  });
});

function ctxLabel(status: "late" | "absent") {
  return ({ late: "متأخر", absent: "غائب" })[status];
}
