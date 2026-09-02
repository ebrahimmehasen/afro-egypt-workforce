"use server";

import { prisma } from "@/lib/prisma";
import { DEMO_DATE, DEMO_EMPLOYEE_ID, DEMO_PERIOD_ID } from "@/lib/constants";
import {
  toDailyAttendance,
  toDeduction,
  toDepartment,
  toEmployee,
  toOvertime,
  toPayrollPeriod,
  toPayrollRecord,
} from "@/lib/serialize";

export async function getDemoSnapshot() {
  const demoDay = new Date(`${DEMO_DATE}T00:00:00.000Z`);

  const employeeRow = await prisma.employee.findUniqueOrThrow({ where: { id: DEMO_EMPLOYEE_ID } });
  const [departmentRow, attendanceRow, overtimeRow, deductionRows, periodRow, payrollRow, periodRecords] =
    await Promise.all([
      prisma.department.findUnique({ where: { id: employeeRow.departmentId } }),
      prisma.dailyAttendance.findUnique({
        where: { employeeId_date: { employeeId: DEMO_EMPLOYEE_ID, date: demoDay } },
      }),
      prisma.overtime.findFirst({
        where: { employeeId: DEMO_EMPLOYEE_ID, date: demoDay },
        orderBy: { createdAt: "desc" },
      }),
      prisma.deduction.findMany({ where: { employeeId: DEMO_EMPLOYEE_ID, date: demoDay } }),
      prisma.payrollPeriod.findUnique({ where: { id: DEMO_PERIOD_ID } }),
      prisma.payrollRecord.findUnique({
        where: { periodId_employeeId: { periodId: DEMO_PERIOD_ID, employeeId: DEMO_EMPLOYEE_ID } },
      }),
      prisma.payrollRecord.findMany({ where: { periodId: DEMO_PERIOD_ID } }),
    ]);

  return {
    employee: toEmployee(employeeRow),
    department: departmentRow ? toDepartment(departmentRow) : undefined,
    attendance: attendanceRow ? toDailyAttendance(attendanceRow) : null,
    overtime: overtimeRow ? toOvertime(overtimeRow) : null,
    deductions: deductionRows.map(toDeduction),
    period: periodRow ? toPayrollPeriod(periodRow) : null,
    payrollRecord: payrollRow ? toPayrollRecord(payrollRow) : null,
    workforceCostTotal: periodRecords.reduce((sum, r) => sum + r.netSalary, 0),
  };
}
