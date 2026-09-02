"use server";

import { getDb } from "@/lib/data";
import { DEMO_DATE, DEMO_EMPLOYEE_ID, DEMO_PERIOD_ID } from "@/lib/constants";

export async function getDemoSnapshot() {
  const db = getDb();
  const employee = db.employees.find((e) => e.id === DEMO_EMPLOYEE_ID)!;
  const department = db.departments.find((d) => d.id === employee.departmentId);
  const attendance = db.dailyAttendance.find((a) => a.employeeId === DEMO_EMPLOYEE_ID && a.date === DEMO_DATE) ?? null;
  const overtime = db.overtime
    .filter((o) => o.employeeId === DEMO_EMPLOYEE_ID && o.date === DEMO_DATE)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
  const deductions = db.deductions.filter((d) => d.employeeId === DEMO_EMPLOYEE_ID && d.date === DEMO_DATE);
  const period = db.payrollPeriods.find((p) => p.id === DEMO_PERIOD_ID) ?? null;
  const payrollRecord = db.payrollRecords.find((r) => r.employeeId === DEMO_EMPLOYEE_ID && r.periodId === DEMO_PERIOD_ID) ?? null;
  const workforceCostBefore = db.payrollRecords
    .filter((r) => r.periodId === DEMO_PERIOD_ID)
    .reduce((sum, r) => sum + r.netSalary, 0);

  return {
    employee,
    department,
    attendance,
    overtime,
    deductions,
    period,
    payrollRecord,
    workforceCostTotal: workforceCostBefore,
  };
}
