/**
 * Database seed — mirrors the in-memory demo seed (src/lib/seed.ts) exactly:
 * same 6 departments, 3 shifts, 50 employees (8 scripted), 13 days of history,
 * the scripted "today" (2026-08-21) scenarios, one draft payroll period for
 * August 2026, and the demo login accounts (now with hashed passwords).
 *
 * Idempotent: wipes every table first, then re-inserts. Safe to re-run.
 *
 * Run with:  npm run db:seed   (needs a reachable MySQL + `prisma migrate`)
 */
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { computeDailyAttendance, getShiftWindow } from "../src/lib/attendance-engine";
import { mulberry32 } from "../src/lib/id";
import type { AttendanceLog, Shift } from "../src/lib/types";

const prisma = new PrismaClient();

const DEMO_DATE = "2026-08-21";
const DEVICE_ID = "ZK-DEMO-01";

const DEPARTMENT_NAMES = ["الإنتاج", "المخازن", "الصيانة", "الأمن", "الموارد البشرية", "الحسابات"] as const;

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

const MALE_FIRST = [
  "أحمد","محمد","محمود","علي","عمر","يوسف","إبراهيم","مصطفى","خالد","حسن","حسين","كريم","طارق","وليد","أيمن",
  "رامي","شريف","عصام","ياسر","سامح","هاني","عادل","سيد","جمال","ماهر","فتحي","رضا","صلاح","عبدالله","عبدالرحمن",
  "أسامة","جمعة","نبيل","سعيد","أشرف",
];
const FEMALE_FIRST = [
  "فاطمة","مريم","سارة","نور","هبة","داليا","رانيا","ياسمين","أميرة","إيمان","نهى","سلمى","منى","دينا","نادية",
];
const LAST_NAMES = [
  "علي","حسن","محمود","إبراهيم","السيد","عبدالله","فؤاد","الديب","الشريف","حجازي","عبدالعزيز","راغب","صديق","نصار",
  "البنا","حماد","زكي","درويش","سلامة","عثمان","جاد","فهمي","قنديل","غانم","يوسف","كامل","رزق","شعبان","متولي","بركات",
];

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
function plusMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60000);
}
function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}
function dateOnly(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`);
}

type EmployeeSeed = {
  id: string;
  name: string;
  departmentId: string;
  jobTitle: string;
  hireDate: string;
  shiftId: string;
  basicSalary: number;
  allowancesTotal: number;
  biometricDeviceUserId: string;
  status: "active";
};

const SHIFTS: Shift[] = [
  { id: "SHIFT-MORNING", name: "الوردية الصباحية", startTime: "08:00", endTime: "16:00", gracePeriodMinutes: 10, workDays: [0, 1, 2, 3, 4, 5], allowOvertime: true },
  { id: "SHIFT-EVENING", name: "الوردية المسائية", startTime: "16:00", endTime: "00:00", gracePeriodMinutes: 10, workDays: [0, 1, 2, 3, 4, 5], allowOvertime: true },
  { id: "SHIFT-NIGHT", name: "الوردية الليلية", startTime: "00:00", endTime: "08:00", gracePeriodMinutes: 10, workDays: [0, 1, 2, 3, 4, 5], allowOvertime: false },
];

function buildEmployees(): EmployeeSeed[] {
  const rng = mulberry32(42);
  const employees: EmployeeSeed[] = [];
  const departments = DEPARTMENT_NAMES.map((name, i) => ({ id: `DEP-${i + 1}`, name }));

  const distribution: [string, number][] = [
    ["الإنتاج", 20], ["المخازن", 8], ["الصيانة", 8], ["الأمن", 6], ["الموارد البشرية", 4], ["الحسابات", 4],
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

  const scripted: Array<Pick<EmployeeSeed, "id" | "name" | "departmentId" | "shiftId" | "jobTitle" | "basicSalary">> = [
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
    usedNames.add(s.name);
    const deptName = departments.find((d) => d.id === s.departmentId)!.name;
    const qIdx = deptQueue.indexOf(deptName);
    if (qIdx >= 0) deptQueue.splice(qIdx, 1);
    employees.push({
      ...s,
      hireDate: isoDate(addDays(DEMO_DATE, -(400 + idx * 37))),
      allowancesTotal: 1000,
      biometricDeviceUserId: `${1001 + idx}`,
      status: "active",
    });
  });

  let seq = 1009;
  for (const deptName of deptQueue) {
    const dept = departments.find((d) => d.name === deptName)!;
    const [min, max] = SALARY_RANGE[deptName];
    const salary = Math.round((min + rng() * (max - min)) / 100) * 100;
    const shift = deptName === "الأمن" ? pick(SHIFTS, rng) : SHIFTS[0];
    employees.push({
      id: `EMP-${seq}`,
      name: uniqueName(),
      departmentId: dept.id,
      jobTitle: pick(JOB_TITLES[deptName], rng),
      hireDate: isoDate(addDays(DEMO_DATE, -Math.floor(60 + rng() * 1200))),
      shiftId: shift.id,
      basicSalary: salary,
      allowancesTotal: Math.round((300 + rng() * 1200) / 50) * 50,
      biometricDeviceUserId: `${seq}`,
      status: "active",
    });
    seq++;
  }

  return employees;
}

// --- attendance generation ------------------------------------------------

const logRows: Prisma.AttendanceLogCreateManyInput[] = [];
const dailyRows: Prisma.DailyAttendanceCreateManyInput[] = [];
let logSeq = 0;

function pushPunchAt(employeeId: string, at: Date, punchType: "in" | "out"): AttendanceLog {
  logSeq++;
  const row = {
    id: `LOG-${logSeq}`,
    employeeId,
    deviceId: DEVICE_ID,
    timestamp: at.toISOString(),
    punchType,
    source: "simulated" as const,
  };
  logRows.push({ ...row, timestamp: at });
  return row;
}

function computeAndStore(
  employeeId: string,
  dateIso: string,
  shift: Shift,
  logs: AttendanceLog[],
  opts?: { isOnApprovedLeave?: boolean; leaveType?: "mission" | "excused_absence" | "leave" },
) {
  const computed = computeDailyAttendance({
    employeeId,
    date: dateIso,
    shift,
    logs,
    isOnApprovedLeave: opts?.isOnApprovedLeave ?? false,
    leaveType: opts?.leaveType,
  });
  dailyRows.push({
    employeeId,
    date: dateOnly(dateIso),
    shiftId: shift.id,
    scheduledStart: computed.scheduledStart,
    scheduledEnd: computed.scheduledEnd,
    actualIn: computed.actualIn,
    actualOut: computed.actualOut,
    lateMinutes: computed.lateMinutes,
    deductibleLateMinutes: computed.deductibleLateMinutes,
    earlyLeaveMinutes: computed.earlyLeaveMinutes,
    workedMinutes: computed.workedMinutes,
    overtimeMinutes: computed.overtimeMinutes,
    status: computed.status,
  });
}

function seedDayForEmployee(emp: EmployeeSeed, dateIso: string, shift: Shift, rng: () => number) {
  const roll = rng();
  const logs: AttendanceLog[] = [];
  const { scheduledStart, scheduledEnd } = getShiftWindow(dateIso, shift);

  if (roll < 0.68) {
    logs.push(pushPunchAt(emp.id, plusMinutes(scheduledStart, Math.round(rng() * 6) - 3), "in"));
    logs.push(pushPunchAt(emp.id, plusMinutes(scheduledEnd, Math.round(rng() * 10) - 2), "out"));
  } else if (roll < 0.85) {
    logs.push(pushPunchAt(emp.id, plusMinutes(scheduledStart, 8 + Math.round(rng() * 32)), "in"));
    logs.push(pushPunchAt(emp.id, scheduledEnd, "out"));
  } else if (roll < 0.93) {
    // absent — no punches
  } else if (roll < 0.97) {
    logs.push(pushPunchAt(emp.id, scheduledStart, "in"));
  } else {
    logs.push(pushPunchAt(emp.id, scheduledStart, "in"));
    logs.push(pushPunchAt(emp.id, plusMinutes(scheduledEnd, -(15 + Math.round(rng() * 45))), "out"));
  }
  computeAndStore(emp.id, dateIso, shift, logs);
}

function seedExplicitDay(
  employeeId: string,
  dateIso: string,
  shift: Shift,
  inOffset: number | null,
  outOffset: number | null,
) {
  const { scheduledStart, scheduledEnd } = getShiftWindow(dateIso, shift);
  const logs: AttendanceLog[] = [];
  if (inOffset !== null) logs.push(pushPunchAt(employeeId, plusMinutes(scheduledStart, inOffset), "in"));
  if (outOffset !== null) logs.push(pushPunchAt(employeeId, plusMinutes(scheduledEnd, outOffset), "out"));
  computeAndStore(employeeId, dateIso, shift, logs);
}

async function main() {
  const employees = buildEmployees();
  const shiftById = new Map(SHIFTS.map((s) => [s.id, s]));
  const SCRIPTED = new Set(["EMP-1001","EMP-1002","EMP-1003","EMP-1004","EMP-1005","EMP-1006","EMP-1007","EMP-1008"]);
  const morning = shiftById.get("SHIFT-MORNING")!;
  const evening = shiftById.get("SHIFT-EVENING")!;

  // ---- history: DEMO_DATE-13 .. DEMO_DATE-1 --------------------------------
  const histRng = mulberry32(7);
  for (const emp of employees) {
    const shift = shiftById.get(emp.shiftId)!;
    for (let back = 13; back >= 1; back--) {
      const date = addDays(DEMO_DATE, -back);
      if (!shift.workDays.includes(date.getDay())) continue;
      seedDayForEmployee(emp, isoDate(date), shift, histRng);
    }
  }

  // ---- today scripted scenarios -----------------------------------------
  // EMP-1001: left un-punched today (the live demo records it)
  seedExplicitDay("EMP-1002", DEMO_DATE, morning, 2, 4);
  computeAndStore("EMP-1003", DEMO_DATE, morning, []); // absent
  computeAndStore("EMP-1004", DEMO_DATE, morning, [], { isOnApprovedLeave: true, leaveType: "leave" });
  seedExplicitDay("EMP-1005", DEMO_DATE, morning, -2, null); // missing checkout
  seedExplicitDay("EMP-1006", DEMO_DATE, morning, -5, 130); // overtime
  seedExplicitDay("EMP-1007", DEMO_DATE, evening, 5, 2);
  seedExplicitDay("EMP-1008", DEMO_DATE, morning, 1, 0);

  const todayRng = mulberry32(99);
  const todayDow = new Date(`${DEMO_DATE}T00:00:00`).getDay();
  for (const emp of employees) {
    if (SCRIPTED.has(emp.id)) continue;
    const shift = shiftById.get(emp.shiftId)!;
    if (!shift.workDays.includes(todayDow)) continue;
    seedDayForEmployee(emp, DEMO_DATE, shift, todayRng);
  }

  const emp1006Basic = employees.find((e) => e.id === "EMP-1006")!.basicSalary;
  const ot1006Rate = Math.round((emp1006Basic / 26 / 8) * 1.5);

  // ---- wipe -------------------------------------------------------------
  await prisma.$transaction([
    prisma.payrollRecord.deleteMany(),
    prisma.payrollPeriod.deleteMany(),
    prisma.dailyAttendance.deleteMany(),
    prisma.attendanceLog.deleteMany(),
    prisma.leave.deleteMany(),
    prisma.overtime.deleteMany(),
    prisma.deduction.deleteMany(),
    prisma.allowance.deleteMany(),
    prisma.auditLogEntry.deleteMany(),
    prisma.user.deleteMany(),
    prisma.employee.deleteMany(),
    prisma.department.deleteMany(),
    prisma.shift.deleteMany(),
    prisma.device.deleteMany(),
    prisma.companySettings.deleteMany(),
    prisma.attendanceSettings.deleteMany(),
    prisma.payrollSettings.deleteMany(),
  ]);

  // ---- write ----------------------------------------------------------
  await prisma.companySettings.create({
    data: { companyName: "Afro Egypt", logoUrl: "/brand/afro-egypt-logo.jpg", address: "المنطقة الصناعية، القاهرة، مصر", phone: "+20 2 0000 0000" },
  });
  await prisma.attendanceSettings.create({ data: {} });
  await prisma.payrollSettings.create({ data: {} });

  await prisma.device.create({ data: { id: DEVICE_ID, name: "جهاز البصمة التجريبي", location: "البوابة الرئيسية" } });

  await prisma.department.createMany({
    data: DEPARTMENT_NAMES.map((name, i) => ({ id: `DEP-${i + 1}`, name, managerName: DEPARTMENT_MANAGERS[name] })),
  });
  await prisma.shift.createMany({
    data: SHIFTS.map((s) => ({
      id: s.id, name: s.name, startTime: s.startTime, endTime: s.endTime,
      gracePeriodMinutes: s.gracePeriodMinutes, workDays: s.workDays, allowOvertime: s.allowOvertime,
    })),
  });
  await prisma.employee.createMany({
    data: employees.map((e) => ({ ...e, hireDate: dateOnly(e.hireDate) })),
  });

  // allowances: transport + meal, each half of allowancesTotal
  await prisma.allowance.createMany({
    data: employees.flatMap((e) => [
      { id: `ALW-${e.id}-1`, employeeId: e.id, type: "transport" as const, amount: Math.round(e.allowancesTotal * 0.5), monthly: true },
      { id: `ALW-${e.id}-2`, employeeId: e.id, type: "meal" as const, amount: Math.round(e.allowancesTotal * 0.5), monthly: true },
    ]),
  });

  await prisma.attendanceLog.createMany({ data: logRows });
  await prisma.dailyAttendance.createMany({ data: dailyRows });

  await prisma.leave.create({
    data: {
      id: "LV-SEED-1", employeeId: "EMP-1004", type: "annual",
      from: dateOnly(DEMO_DATE), to: dateOnly(isoDate(addDays(DEMO_DATE, 1))),
      reason: "إجازة سنوية مجدولة", status: "approved", approvedBy: "HR Manager",
      createdAt: new Date(`${isoDate(addDays(DEMO_DATE, -5))}T09:00:00`),
    },
  });

  await prisma.overtime.create({
    data: {
      id: "OT-SEED-1", employeeId: "EMP-1006", date: dateOnly(DEMO_DATE), hours: 2.2,
      hourlyRate: ot1006Rate, amount: Math.round(2.2 * ot1006Rate), status: "pending",
      notes: "إضافي جرد نهاية الشهر", createdAt: new Date(`${DEMO_DATE}T18:15:00`),
    },
  });

  await prisma.deduction.createMany({
    data: [
      { id: "DED-SEED-1", employeeId: "EMP-1007", type: "penalty", amount: 300, date: dateOnly(isoDate(addDays(DEMO_DATE, -3))), reason: "مخالفة إجراءات الأمن الداخلية", createdAt: new Date(`${isoDate(addDays(DEMO_DATE, -3))}T10:00:00`) },
      { id: "DED-SEED-2", employeeId: "EMP-1008", type: "advance", amount: 1000, date: dateOnly(isoDate(addDays(DEMO_DATE, -10))), reason: "سلفة على المرتب", createdAt: new Date(`${isoDate(addDays(DEMO_DATE, -10))}T11:00:00`) },
      { id: "DED-SEED-3", employeeId: "EMP-1008", type: "admin_deduction", amount: 150, date: dateOnly(isoDate(addDays(DEMO_DATE, -6))), reason: "عدم ارتداء الزي الموحد", createdAt: new Date(`${isoDate(addDays(DEMO_DATE, -6))}T11:00:00`) },
    ],
  });

  await prisma.payrollPeriod.create({
    data: { id: "PP-2026-08", label: "أغسطس 2026", year: 2026, month: 8, status: "draft" },
  });

  await prisma.auditLogEntry.createMany({
    data: [
      { userName: "Ahmed HR", action: "تعديل حضور", module: "الحضور والانصراف", oldValue: "الخروج: غير موجود", newValue: "الخروج: 16:05", reason: "الموظف نسي تسجيل الانصراف", timestamp: new Date(`${isoDate(addDays(DEMO_DATE, -4))}T17:30:00`) },
      { userName: "مدير النظام", action: "اعتماد إضافي", module: "الإضافي", oldValue: "معلق", newValue: "معتمد", timestamp: new Date(`${isoDate(addDays(DEMO_DATE, -2))}T12:00:00`) },
      { userName: "Ahmed HR", action: "اعتماد إجازة", module: "الإجازات والأعذار", oldValue: "معلق", newValue: "معتمد", timestamp: new Date(`${isoDate(addDays(DEMO_DATE, -5))}T09:05:00`) },
    ],
  });

  // ---- demo users (hashed passwords) ---------------------------------
  const hash = await bcrypt.hash("demo123", 10);
  await prisma.user.createMany({
    data: [
      { id: "USR-1", name: "مدير النظام", email: "admin@404legends.demo", passwordHash: hash, role: "admin" },
      { id: "USR-2", name: "Ahmed HR", email: "hr@afroegypt.demo", passwordHash: hash, role: "hr" },
      { id: "USR-3", name: "مشرف الإنتاج", email: "supervisor@afroegypt.demo", passwordHash: hash, role: "supervisor", departmentId: "DEP-1" },
      { id: "USR-4", name: "أحمد علي", email: "ahmed@afroegypt.demo", passwordHash: hash, role: "employee", employeeId: "EMP-1001" },
    ],
  });

  const counts = {
    employees: await prisma.employee.count(),
    dailyAttendance: await prisma.dailyAttendance.count(),
    attendanceLogs: await prisma.attendanceLog.count(),
    users: await prisma.user.count(),
  };
  console.log("Seed complete:", counts);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
