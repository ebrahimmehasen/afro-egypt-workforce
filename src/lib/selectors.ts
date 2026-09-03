import { getDb } from "@/lib/data";
import { Scope, scopedSnapshot } from "@/lib/scope";
import { today } from "@/lib/today";
import { AttendanceStatus, DailyAttendance } from "@/lib/types";
import { ATTENDANCE_STATUS_GROUPS } from "@/lib/attendance-engine";

/**
 * Dashboard / report read models. Each takes the viewer's `Scope` as its first
 * argument (build it with `viewerScope`) so a company-wide read is always an
 * explicit choice, never an accidental omission.
 */
async function snapshot(scope: Scope) {
  return scopedSnapshot(scope, await getDb());
}

export async function getTodayAttendance(scope: Scope, date: string = today()): Promise<DailyAttendance[]> {
  const db = await snapshot(scope);
  return db.dailyAttendance.filter((a) => a.date === date);
}

export async function getTodayKpis(scope: Scope, date: string = today()) {
  const db = await snapshot(scope);
  const dayRecords = db.dailyAttendance.filter((a) => a.date === date);
  const totalEmployees = db.employees.filter((e) => e.status === "active").length;

  const count = (status: AttendanceStatus) => dayRecords.filter((a) => a.status === status).length;

  return {
    totalEmployees,
    presentToday: dayRecords.filter((a) => ATTENDANCE_STATUS_GROUPS.present!.includes(a.status)).length,
    absentToday: count("absent"),
    lateToday: count("late"),
    onLeaveToday: dayRecords.filter((a) => ATTENDANCE_STATUS_GROUPS.leave!.includes(a.status)).length,
    missingPunchToday: count("missing_punch"),
    notYetRecorded: totalEmployees - dayRecords.length,
  };
}

export async function getMonthlyKpis(scope: Scope, year: number, month: number) {
  const db = await snapshot(scope);
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const monthAttendance = db.dailyAttendance.filter((a) => a.date.startsWith(prefix));

  const attendanceSettings = db.attendanceSettings;
  const payrollSettings = db.payrollSettings;

  let lateCost = 0;
  let absenceCost = 0;
  for (const a of monthAttendance) {
    const employee = db.employees.find((e) => e.id === a.employeeId);
    if (!employee) continue;
    lateCost += a.deductibleLateMinutes * attendanceSettings.lateDeductionPerMinute;
    if (a.status === "absent") {
      absenceCost += employee.basicSalary / payrollSettings.workingDaysPerMonth;
    }
  }

  const overtimeTotal = db.overtime
    .filter((o) => o.date.startsWith(prefix) && o.status === "approved")
    .reduce((sum, o) => sum + o.amount, 0);

  const deductionsTotal = db.deductions
    .filter((d) => d.date.startsWith(prefix))
    .reduce((sum, d) => sum + d.amount, 0);

  const payrollRecords = db.payrollRecords.filter((r) => {
    const period = db.payrollPeriods.find((p) => p.id === r.periodId);
    return period && period.year === year && period.month === month;
  });
  const totalPayroll = payrollRecords.reduce((sum, r) => sum + r.netSalary, 0);

  return {
    totalPayroll,
    overtimeTotal,
    deductionsTotal,
    absenceCost: Math.round(absenceCost),
    lateCost: Math.round(lateCost),
    payrollCalculated: payrollRecords.length > 0,
  };
}

export async function getAttendanceTrend(scope: Scope, days = 14, endDate: string = today()) {
  const db = await snapshot(scope);
  const end = new Date(`${endDate}T00:00:00`);
  const trend: { date: string; present: number; late: number; absent: number }[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const dayRecords = db.dailyAttendance.filter((a) => a.date === iso);
    if (dayRecords.length === 0) continue;
    trend.push({
      date: iso,
      present: dayRecords.filter((a) => ATTENDANCE_STATUS_GROUPS.present!.includes(a.status)).length,
      late: dayRecords.filter((a) => a.status === "late").length,
      absent: dayRecords.filter((a) => a.status === "absent").length,
    });
  }
  return trend;
}

export async function getAttendanceByDepartment(scope: Scope, date: string = today()) {
  const db = await snapshot(scope);
  const dayRecords = db.dailyAttendance.filter((a) => a.date === date);
  const departments = scope.all
    ? db.departments
    : db.departments.filter((dept) => db.employees.some((e) => e.departmentId === dept.id));
  return departments.map((dept) => {
    const deptEmployeeIds = db.employees.filter((e) => e.departmentId === dept.id).map((e) => e.id);
    const records = dayRecords.filter((a) => deptEmployeeIds.includes(a.employeeId));
    const present = records.filter((a) => ATTENDANCE_STATUS_GROUPS.present!.includes(a.status)).length;
    return {
      department: dept.name,
      present,
      total: deptEmployeeIds.length,
      rate: deptEmployeeIds.length ? Math.round((present / deptEmployeeIds.length) * 100) : 0,
    };
  });
}

export async function getTopLateEmployees(scope: Scope, limit = 5, days = 30, endDate: string = today()) {
  const db = await snapshot(scope);
  const end = new Date(`${endDate}T00:00:00`);
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const tally = new Map<string, { minutes: number; count: number }>();
  for (const a of db.dailyAttendance) {
    const d = new Date(`${a.date}T00:00:00`);
    if (d < start || d > end) continue;
    if (a.deductibleLateMinutes <= 0) continue;
    const cur = tally.get(a.employeeId) ?? { minutes: 0, count: 0 };
    cur.minutes += a.deductibleLateMinutes;
    cur.count += 1;
    tally.set(a.employeeId, cur);
  }

  return [...tally.entries()]
    .map(([employeeId, v]) => ({
      employee: db.employees.find((e) => e.id === employeeId),
      ...v,
    }))
    .filter((x) => x.employee)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, limit);
}

export async function getWorkforceCostByDepartment(scope: Scope, year: number, month: number) {
  const db = await snapshot(scope);
  const records = db.payrollRecords.filter((r) => {
    const period = db.payrollPeriods.find((p) => p.id === r.periodId);
    return period && period.year === year && period.month === month;
  });

  const departments = scope.all
    ? db.departments
    : db.departments.filter((dept) => db.employees.some((e) => e.departmentId === dept.id));

  return departments.map((dept) => {
    const deptEmployeeIds = db.employees.filter((e) => e.departmentId === dept.id).map((e) => e.id);
    const deptRecords = records.filter((r) => deptEmployeeIds.includes(r.employeeId));
    return {
      department: dept.name,
      total: deptRecords.reduce((sum, r) => sum + r.netSalary, 0),
      overtime: deptRecords.reduce((sum, r) => sum + r.overtimeAmount, 0),
      deductions: deptRecords.reduce((sum, r) => sum + r.totalDeductions, 0),
    };
  });
}
