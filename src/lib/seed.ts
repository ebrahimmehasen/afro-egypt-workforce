import { computeDailyAttendance, getShiftWindow } from "@/lib/attendance-engine";
import { DEMO_DATE, DEPARTMENT_NAMES } from "@/lib/constants";
import { mulberry32 } from "@/lib/id";
import { db } from "@/lib/store";
import {
  AttendanceLog,
  DailyAttendance,
  Department,
  Employee,
  Shift,
} from "@/lib/types";

export const DEVICE_ID = "ZK-DEMO-01";

const MALE_FIRST = [
  "أحمد", "محمد", "محمود", "علي", "عمر", "يوسف", "إبراهيم", "مصطفى", "خالد", "حسن",
  "حسين", "كريم", "طارق", "وليد", "أيمن", "رامي", "شريف", "عصام", "ياسر", "سامح",
  "هاني", "عادل", "سيد", "جمال", "ماهر", "فتحي", "رضا", "صلاح", "عبدالله", "عبدالرحمن",
  "أسامة", "جمعة", "نبيل", "سعيد", "أشرف",
];
const FEMALE_FIRST = [
  "فاطمة", "مريم", "سارة", "نور", "هبة", "داليا", "رانيا", "ياسمين", "أميرة", "إيمان",
  "نهى", "سلمى", "منى", "دينا", "نادية",
];
const LAST_NAMES = [
  "علي", "حسن", "محمود", "إبراهيم", "السيد", "عبدالله", "فؤاد", "الديب", "الشريف", "حجازي",
  "عبدالعزيز", "راغب", "صديق", "نصار", "البنا", "حماد", "زكي", "درويش", "سلامة", "عثمان",
  "جاد", "فهمي", "قنديل", "غانم", "يوسف", "كامل", "رزق", "شعبان", "متولي", "بركات",
];

const DEPARTMENT_MANAGERS: Record<string, string> = {
  الإنتاج: "مهندس/ كريم عبدالعزيز",
  المخازن: "أ/ سيد فهمي",
  الصيانة: "مهندس/ طارق حجازي",
  الأمن: "أ/ رضا غانم",
  "الموارد البشرية": "أ/ إيمان فؤاد",
  الحسابات: "أ/ عادل زكي",
};

const JOB_TITLES: Record<string, string[]> = {
  الإنتاج: ["عامل إنتاج", "عامل خط تعبئة", "فني تشغيل", "مشرف خط إنتاج"],
  المخازن: ["عامل مخزن", "أمين مخزن", "مراقب مخزون"],
  الصيانة: ["عامل صيانة", "فني صيانة", "مهندس صيانة"],
  الأمن: ["فرد أمن", "رئيس وردية أمن"],
  "الموارد البشرية": ["أخصائي موارد بشرية", "مسؤول شؤون عاملين"],
  الحسابات: ["محاسب", "أمين صندوق", "مراجع حسابات"],
};

const SALARY_RANGE: Record<string, [number, number]> = {
  الإنتاج: [7500, 13000],
  المخازن: [7800, 12000],
  الصيانة: [9000, 16000],
  الأمن: [7000, 10000],
  "الموارد البشرية": [11000, 19000],
  الحسابات: [11000, 21000],
};

function pad(n: number, len = 2) {
  return String(n).padStart(len, "0");
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(dateIso: string, days: number) {
  const d = new Date(`${dateIso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d;
}

function seedDepartmentsAndShifts() {
  const departments: Department[] = DEPARTMENT_NAMES.map((name, i) => ({
    id: `DEP-${i + 1}`,
    name,
    managerName: DEPARTMENT_MANAGERS[name],
  }));

  const shifts: Shift[] = [
    {
      id: "SHIFT-MORNING",
      name: "الوردية الصباحية",
      startTime: "08:00",
      endTime: "16:00",
      gracePeriodMinutes: 10,
      workDays: [0, 1, 2, 3, 4, 5], // Sunday - Friday (factory runs 6 days/week; Saturday off)
      allowOvertime: true,
    },
    {
      id: "SHIFT-EVENING",
      name: "الوردية المسائية",
      startTime: "16:00",
      endTime: "00:00",
      gracePeriodMinutes: 10,
      workDays: [0, 1, 2, 3, 4, 5],
      allowOvertime: true,
    },
    {
      id: "SHIFT-NIGHT",
      name: "الوردية الليلية",
      startTime: "00:00",
      endTime: "08:00",
      gracePeriodMinutes: 10,
      workDays: [0, 1, 2, 3, 4, 5],
      allowOvertime: false,
    },
  ];

  db.departments.push(...departments);
  db.shifts.push(...shifts);
  return { departments, shifts };
}

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function seedEmployees(departments: Department[], shifts: Shift[]) {
  const rng = mulberry32(42);
  const employees: Employee[] = [];

  // Department distribution across 50 employees (matches spec order)
  const distribution: [string, number][] = [
    ["الإنتاج", 20],
    ["المخازن", 8],
    ["الصيانة", 8],
    ["الأمن", 6],
    ["الموارد البشرية", 4],
    ["الحسابات", 4],
  ];

  const deptQueue: string[] = [];
  distribution.forEach(([name, count]) => {
    for (let i = 0; i < count; i++) deptQueue.push(name);
  });

  const usedNames = new Set<string>();
  function uniqueName(): string {
    let name = "";
    let attempts = 0;
    do {
      const first = rng() < 0.82 ? pick(MALE_FIRST, rng) : pick(FEMALE_FIRST, rng);
      const last = pick(LAST_NAMES, rng);
      name = `${first} ${last}`;
      attempts++;
    } while (usedNames.has(name) && attempts < 50);
    usedNames.add(name);
    return name;
  }

  // 8 scripted demo employees (spec §41) — fixed identities for a predictable demo
  const scripted: Partial<Employee>[] = [
    { id: "EMP-1001", name: "أحمد علي", departmentId: "DEP-1", shiftId: "SHIFT-MORNING", jobTitle: "عامل خط تعبئة", basicSalary: 12000 },
    { id: "EMP-1002", name: "محمود حسن", departmentId: "DEP-1", shiftId: "SHIFT-MORNING", jobTitle: "عامل إنتاج", basicSalary: 9500 },
    { id: "EMP-1003", name: "يوسف إبراهيم", departmentId: "DEP-1", shiftId: "SHIFT-MORNING", jobTitle: "عامل إنتاج", basicSalary: 8800 },
    { id: "EMP-1004", name: "فاطمة السيد", departmentId: "DEP-5", shiftId: "SHIFT-MORNING", jobTitle: "أخصائي موارد بشرية", basicSalary: 13500 },
    { id: "EMP-1005", name: "خالد عبدالله", departmentId: "DEP-3", shiftId: "SHIFT-MORNING", jobTitle: "فني صيانة", basicSalary: 11000 },
    { id: "EMP-1006", name: "مريم فؤاد", departmentId: "DEP-6", shiftId: "SHIFT-MORNING", jobTitle: "محاسب", basicSalary: 14000 },
    { id: "EMP-1007", name: "عمر الشريف", departmentId: "DEP-4", shiftId: "SHIFT-EVENING", jobTitle: "فرد أمن", basicSalary: 7500 },
    { id: "EMP-1008", name: "طارق حجازي", departmentId: "DEP-2", shiftId: "SHIFT-MORNING", jobTitle: "أمين مخزن", basicSalary: 10500 },
  ];

  scripted.forEach((s, idx) => {
    usedNames.add(s.name as string);
    // remove one slot from that department's queue
    const qIdx = deptQueue.indexOf(departments.find((d) => d.id === s.departmentId)!.name);
    if (qIdx >= 0) deptQueue.splice(qIdx, 1);
    employees.push({
      id: s.id!,
      name: s.name!,
      departmentId: s.departmentId!,
      jobTitle: s.jobTitle!,
      hireDate: isoDate(addDays(DEMO_DATE, -(400 + idx * 37))),
      shiftId: s.shiftId!,
      basicSalary: s.basicSalary!,
      allowances: 1000,
      biometricDeviceUserId: `${1001 + idx}`,
      status: "active",
    });
  });

  let seq = 1009;
  for (const deptName of deptQueue) {
    const dept = departments.find((d) => d.name === deptName)!;
    const [min, max] = SALARY_RANGE[deptName];
    const salary = Math.round((min + rng() * (max - min)) / 100) * 100;
    const shift = deptName === "الأمن" ? pick(shifts, rng) : shifts[0];
    employees.push({
      id: `EMP-${seq}`,
      name: uniqueName(),
      departmentId: dept.id,
      jobTitle: pick(JOB_TITLES[deptName], rng),
      hireDate: isoDate(addDays(DEMO_DATE, -Math.floor(60 + rng() * 1200))),
      shiftId: shift.id,
      basicSalary: salary,
      allowances: Math.round((300 + rng() * 1200) / 50) * 50,
      biometricDeviceUserId: `${seq}`,
      status: "active",
    });
    seq++;
  }

  db.employees.push(...employees);
  return employees;
}

/** Pushes a raw punch at an exact Date/time — never reconstructed from a "date+HH:MM" string,
 * so shifts crossing midnight (e.g. evening/night) can never land the punch on the wrong calendar day. */
function pushPunchAt(employeeId: string, at: Date, type: "in" | "out") {
  const log: AttendanceLog = {
    id: `LOG-${db.attendanceLogs.length + 1}`,
    employeeId,
    deviceId: DEVICE_ID,
    timestamp: at.toISOString(),
    punchType: type,
    source: "simulated",
  };
  db.attendanceLogs.push(log);
  return log;
}

function plusMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60000);
}

/** Generates realistic historical attendance for one employee/day and stores raw logs + computed DailyAttendance. */
function seedDayForEmployee(employee: Employee, dateIso: string, shift: Shift, rng: () => number) {
  const roll = rng();
  const logsForDay: AttendanceLog[] = [];
  const { scheduledStart, scheduledEnd } = getShiftWindow(dateIso, shift);

  if (roll < 0.68) {
    // present, on time
    const inOffset = Math.round(rng() * 6) - 3; // small variance
    const outOffset = Math.round(rng() * 10) - 2;
    logsForDay.push(pushPunchAt(employee.id, plusMinutes(scheduledStart, inOffset), "in"));
    logsForDay.push(pushPunchAt(employee.id, plusMinutes(scheduledEnd, outOffset), "out"));
  } else if (roll < 0.85) {
    // late
    const lateBy = 8 + Math.round(rng() * 32);
    logsForDay.push(pushPunchAt(employee.id, plusMinutes(scheduledStart, lateBy), "in"));
    logsForDay.push(pushPunchAt(employee.id, scheduledEnd, "out"));
  } else if (roll < 0.93) {
    // absent — no punches
  } else if (roll < 0.97) {
    // missing punch — only IN
    logsForDay.push(pushPunchAt(employee.id, scheduledStart, "in"));
  } else {
    // early leave
    logsForDay.push(pushPunchAt(employee.id, scheduledStart, "in"));
    logsForDay.push(pushPunchAt(employee.id, plusMinutes(scheduledEnd, -(15 + Math.round(rng() * 45))), "out"));
  }

  const computed = computeDailyAttendance({
    employeeId: employee.id,
    date: dateIso,
    shift,
    logs: logsForDay,
    isOnApprovedLeave: false,
  });

  const record: DailyAttendance = {
    id: `DA-${db.dailyAttendance.length + 1}`,
    employeeId: employee.id,
    date: dateIso,
    shiftId: shift.id,
    scheduledStart: computed.scheduledStart.toISOString(),
    scheduledEnd: computed.scheduledEnd.toISOString(),
    actualIn: computed.actualIn?.toISOString() ?? null,
    actualOut: computed.actualOut?.toISOString() ?? null,
    lateMinutes: computed.lateMinutes,
    deductibleLateMinutes: computed.deductibleLateMinutes,
    earlyLeaveMinutes: computed.earlyLeaveMinutes,
    workedMinutes: computed.workedMinutes,
    overtimeMinutes: computed.overtimeMinutes,
    status: computed.status,
  };
  db.dailyAttendance.push(record);
}

function seedAttendanceHistory(employees: Employee[]) {
  const rng = mulberry32(7);
  const historyDays = 13; // DEMO_DATE - 13 .. DEMO_DATE - 1

  for (const employee of employees) {
    const shift = db.shifts.find((s) => s.id === employee.shiftId)!;
    for (let back = historyDays; back >= 1; back--) {
      const date = addDays(DEMO_DATE, -back);
      if (!shift.workDays.includes(date.getDay())) continue;
      seedDayForEmployee(employee, isoDate(date), shift, rng);
    }
  }

  // --- Today (DEMO_DATE) scripted scenarios ---
  const morning = db.shifts.find((s) => s.id === "SHIFT-MORNING")!;
  const evening = db.shifts.find((s) => s.id === "SHIFT-EVENING")!;

  // EMP-1001 Ahmed Ali: left un-punched today on purpose — the live demo/manual
  // simulation records his IN/OUT so the story unfolds in front of the user.

  // EMP-1002: perfect attendance today
  seedExplicitDay("EMP-1002", DEMO_DATE, morning, 2, 4);

  // EMP-1003: absent today (no punches, no leave)
  // -- intentionally no logs pushed --
  db.dailyAttendance.push(
    computeAndBuildRecord("EMP-1003", DEMO_DATE, morning, []),
  );

  // EMP-1004: approved leave today (annual)
  db.leaves.push({
    id: "LV-SEED-1",
    employeeId: "EMP-1004",
    type: "annual",
    from: DEMO_DATE,
    to: isoDate(addDays(DEMO_DATE, 1)),
    reason: "إجازة سنوية مجدولة",
    status: "approved",
    approvedBy: "HR Manager",
    createdAt: isoDate(addDays(DEMO_DATE, -5)) + "T09:00:00",
  });
  db.dailyAttendance.push(
    computeAndBuildRecord("EMP-1004", DEMO_DATE, morning, [], { isOnApprovedLeave: true, leaveType: "leave" }),
  );

  // EMP-1005: missing checkout today
  seedExplicitDay("EMP-1005", DEMO_DATE, morning, -2, null);

  // EMP-1006: worked overtime today (in on time, out 2h10m late) — overtime record pending approval
  seedExplicitDay("EMP-1006", DEMO_DATE, morning, -5, 130);
  db.overtime.push({
    id: "OT-SEED-1",
    employeeId: "EMP-1006",
    date: DEMO_DATE,
    hours: 2.2,
    hourlyRate: Math.round((db.employees.find((e) => e.id === "EMP-1006")!.basicSalary / 26 / 8) * 1.5),
    amount: 0,
    status: "pending",
    notes: "إضافي جرد نهاية الشهر",
    createdAt: `${DEMO_DATE}T18:15:00`,
  });
  db.overtime[db.overtime.length - 1].amount = Math.round(
    db.overtime[db.overtime.length - 1].hours * db.overtime[db.overtime.length - 1].hourlyRate,
  );

  // EMP-1007: has a penalty on record (security incident) — present today
  seedExplicitDay("EMP-1007", DEMO_DATE, evening, 5, 2);
  db.deductions.push({
    id: "DED-SEED-1",
    employeeId: "EMP-1007",
    type: "penalty",
    amount: 300,
    date: isoDate(addDays(DEMO_DATE, -3)),
    reason: "مخالفة إجراءات الأمن الداخلية",
    createdAt: isoDate(addDays(DEMO_DATE, -3)) + "T10:00:00",
  });

  // EMP-1008: multiple deductions (advance + admin deduction) — present today
  seedExplicitDay("EMP-1008", DEMO_DATE, morning, 1, 0);
  db.deductions.push(
    {
      id: "DED-SEED-2",
      employeeId: "EMP-1008",
      type: "advance",
      amount: 1000,
      date: isoDate(addDays(DEMO_DATE, -10)),
      reason: "سلفة على المرتب",
      createdAt: isoDate(addDays(DEMO_DATE, -10)) + "T11:00:00",
    },
    {
      id: "DED-SEED-3",
      employeeId: "EMP-1008",
      type: "admin_deduction",
      amount: 150,
      date: isoDate(addDays(DEMO_DATE, -6)),
      reason: "عدم ارتداء الزي الموحد",
      createdAt: isoDate(addDays(DEMO_DATE, -6)) + "T11:00:00",
    },
  );

  // Remaining 42 employees: seed today using the same random model as history
  const rng2 = mulberry32(99);
  for (const employee of employees) {
    if (["EMP-1001", "EMP-1002", "EMP-1003", "EMP-1004", "EMP-1005", "EMP-1006", "EMP-1007", "EMP-1008"].includes(employee.id)) {
      continue;
    }
    const shift = db.shifts.find((s) => s.id === employee.shiftId)!;
    if (!shift.workDays.includes(new Date(`${DEMO_DATE}T00:00:00`).getDay())) continue;
    seedDayForEmployee(employee, DEMO_DATE, shift, rng2);
  }
}

/**
 * Seeds an explicit scenario day using minute-offsets from the shift's scheduled
 * start/end (not literal clock strings) — safe for shifts that cross midnight.
 */
function seedExplicitDay(
  employeeId: string,
  dateIso: string,
  shift: Shift,
  inOffsetFromStart: number | null,
  outOffsetFromEnd: number | null,
) {
  const { scheduledStart, scheduledEnd } = getShiftWindow(dateIso, shift);
  const logs: AttendanceLog[] = [];
  if (inOffsetFromStart !== null) logs.push(pushPunchAt(employeeId, plusMinutes(scheduledStart, inOffsetFromStart), "in"));
  if (outOffsetFromEnd !== null) logs.push(pushPunchAt(employeeId, plusMinutes(scheduledEnd, outOffsetFromEnd), "out"));
  db.dailyAttendance.push(computeAndBuildRecord(employeeId, dateIso, shift, logs));
}

function computeAndBuildRecord(
  employeeId: string,
  dateIso: string,
  shift: Shift,
  logs: AttendanceLog[],
  opts?: { isOnApprovedLeave?: boolean; leaveType?: "mission" | "excused_absence" | "leave" },
): DailyAttendance {
  const computed = computeDailyAttendance({
    employeeId,
    date: dateIso,
    shift,
    logs,
    isOnApprovedLeave: opts?.isOnApprovedLeave ?? false,
    leaveType: opts?.leaveType,
  });
  return {
    id: `DA-${db.dailyAttendance.length + 1}`,
    employeeId,
    date: dateIso,
    shiftId: shift.id,
    scheduledStart: computed.scheduledStart.toISOString(),
    scheduledEnd: computed.scheduledEnd.toISOString(),
    actualIn: computed.actualIn?.toISOString() ?? null,
    actualOut: computed.actualOut?.toISOString() ?? null,
    lateMinutes: computed.lateMinutes,
    deductibleLateMinutes: computed.deductibleLateMinutes,
    earlyLeaveMinutes: computed.earlyLeaveMinutes,
    workedMinutes: computed.workedMinutes,
    overtimeMinutes: computed.overtimeMinutes,
    status: computed.status,
  };
}

function seedAllowances(employees: Employee[]) {
  for (const e of employees) {
    db.allowances.push({
      id: `ALW-${e.id}-1`,
      employeeId: e.id,
      type: "transport",
      amount: Math.round(e.allowances * 0.5),
      monthly: true,
    });
    db.allowances.push({
      id: `ALW-${e.id}-2`,
      employeeId: e.id,
      type: "meal",
      amount: Math.round(e.allowances * 0.5),
      monthly: true,
    });
  }
}

function seedPayrollPeriod() {
  db.payrollPeriods.push({
    id: "PP-2026-08",
    label: "أغسطس 2026",
    year: 2026,
    month: 8,
    status: "draft",
  });
}

function seedAuditLog() {
  addAuditLogSeed({
    userName: "Ahmed HR",
    action: "تعديل حضور",
    module: "الحضور والانصراف",
    oldValue: "الخروج: غير موجود",
    newValue: "الخروج: 16:05",
    reason: "الموظف نسي تسجيل الانصراف",
    timestamp: `${isoDate(addDays(DEMO_DATE, -4))}T17:30:00`,
  });
  addAuditLogSeed({
    userName: "مدير النظام",
    action: "اعتماد إضافي",
    module: "الإضافي",
    oldValue: "معلق",
    newValue: "معتمد",
    timestamp: `${isoDate(addDays(DEMO_DATE, -2))}T12:00:00`,
  });
  addAuditLogSeed({
    userName: "Ahmed HR",
    action: "اعتماد إجازة",
    module: "الإجازات والأعذار",
    oldValue: "معلق",
    newValue: "معتمد",
    timestamp: `${isoDate(addDays(DEMO_DATE, -5))}T09:05:00`,
  });
}

function addAuditLogSeed(entry: {
  userName: string;
  action: string;
  module: string;
  oldValue: string;
  newValue: string;
  reason?: string;
  timestamp: string;
}) {
  db.auditLog.push({
    id: `AUD-SEED-${db.auditLog.length + 1}`,
    ...entry,
  });
}

export function ensureSeeded() {
  if (db.seeded) return;
  db.seeded = true;
  const { departments, shifts } = seedDepartmentsAndShifts();
  const employees = seedEmployees(departments, shifts);
  seedAttendanceHistory(employees);
  seedAllowances(employees);
  seedPayrollPeriod();
  seedAuditLog();
  db.auditLog.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}
