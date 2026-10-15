"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma, TransactionClient } from "@/lib/prisma";
import { recordChangeAs, writeAudit } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { gate } from "@/lib/change-requests";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";
import { Prisma } from "@prisma/client";
import { EmployeeNumberTakenError, generateEmployeeNumber, nextFreeEmployeeNumber } from "@/lib/employee-number";
import { invalidFieldsError } from "@/lib/validation";
import { refreshPayCalculations } from "@/lib/pay-refresh";
import { hasPermission } from "@/lib/permissions";
import { canArchive, deviceLinkClearOnTermination, isArchived } from "@/lib/employee-order";

const employeeSchema = z
  .object({
    name: z.string().min(2),
    departmentId: z.string().min(1),
    jobTitle: z.string().min(1),
    hireDate: z.string().min(1),
    shiftId: z.string().min(1),
    salaryType: z.enum(["monthly", "daily"]).default("monthly"),
    basicSalary: z.coerce.number().min(0).default(0),
    dailyRate: z.coerce.number().min(0).optional(),
    dailyWorkingHours: z.coerce.number().positive().default(10),
    overtimeEligible: z.coerce.boolean().default(true),
    allowances: z.coerce.number().min(0).default(0),
    status: z.enum(["active", "on_leave", "terminated"]),
    phone: z.string().min(6),
    address: z.string().min(3),
    qualification: z.string().min(2),
    militaryStatus: z.enum(["completed", "exempted", "postponed", "not_applicable"]),
    nationalId: z.string().regex(/^\d{14}$/),
    /** Drives the default required-document list — see defaultRequiredDocumentTypes. */
    gender: z.enum(["male", "female"]),
    /** "سواق" — drives the driving-licence / vehicle-receipt requirement. */
    isDriver: z.coerce.boolean().default(false),
  })
  // a salary is always needed (a daily worker's day is it over 26); a daily worker's own day rate can stand in
  .refine((d) => d.basicSalary > 0 || (d.salaryType === "daily" && (d.dailyRate ?? 0) > 0), {
    path: ["salaryType"],
    message: "salary amount required",
  });

// The personal fields are nullable in the DB (older rows have none), and an
// admin's edit may legitimately clear them, so the payload allows null there.
type EmployeePayload = Omit<z.infer<typeof employeeSchema>, "phone" | "address" | "qualification" | "militaryStatus" | "nationalId" | "gender"> & {
  id: string;
  phone: string | null;
  address: string | null;
  qualification: string | null;
  militaryStatus: z.infer<typeof employeeSchema>["militaryStatus"] | null;
  nationalId: string | null;
  /** Null for rows saved before this existed; the admin edit path may leave it unset too. */
  gender?: z.infer<typeof employeeSchema>["gender"];
  /** The pay setup; absent on payloads saved before pay types existed, which then leave it unchanged. */
  pay?: PaySetup;
};

/** Which pay type's rules apply, and the employee's working times: a fixed schedule or custom times. */
interface PaySetup {
  payTypeId: string;
  workScheduleId: string | null;
  customWorkStart: string | null;
  customWorkEnd: string | null;
  customOvertimeStart: string | null;
}

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;

/**
 * Reads the pay part of the employee form. The pay type decides the pay basis (salaryType). The working
 * times are one of: a fixed schedule, custom times (start, end, overtime start — what a daily worker gets),
 * or "shift" to keep following the employee's shift as before. Returns nothing when the form has no pay
 * fields at all, so an older client or a replayed request doesn't wipe anything.
 */
async function readPaySetup(raw: Record<string, unknown>): Promise<{ pay: PaySetup; basis: "monthly" | "daily" } | { fields: string[] } | null> {
  const payTypeId = typeof raw.payTypeId === "string" ? raw.payTypeId : "";
  if (!payTypeId) return null;
  const payType = await prisma.payType.findUnique({ where: { id: payTypeId } });
  if (!payType) return { fields: ["payTypeId"] };

  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const mode = text(raw.scheduleMode) ?? "schedule";
  const pay: PaySetup = { payTypeId, workScheduleId: null, customWorkStart: null, customWorkEnd: null, customOvertimeStart: null };

  if (mode === "schedule") {
    const id = text(raw.workScheduleId);
    if (!id || !(await prisma.workSchedule.findUnique({ where: { id } }))) return { fields: ["workScheduleId"] };
    pay.workScheduleId = id;
  } else if (mode === "custom") {
    const start = text(raw.customWorkStart);
    const end = text(raw.customWorkEnd);
    const overtime = text(raw.customOvertimeStart);
    const bad = [
      !start || !TIME.test(start) ? "customWorkStart" : null,
      !end || !TIME.test(end) ? "customWorkEnd" : null,
      overtime && !TIME.test(overtime) ? "customOvertimeStart" : null,
    ].filter(Boolean) as string[];
    if (bad.length) return { fields: bad };
    Object.assign(pay, { customWorkStart: start, customWorkEnd: end, customOvertimeStart: overtime });
  }
  // mode "shift": no schedule and no custom times — the pay type's times, then the shift, apply
  return { pay, basis: payType.basis };
}

/** Adds the pay setup to a payload, or reports which pay field is wrong. */
async function withPaySetup(payload: EmployeePayload, raw: Record<string, unknown>): Promise<EmployeePayload | { fields: string[] }> {
  const setup = await readPaySetup(raw);
  if (!setup) return payload;
  if ("fields" in setup) return setup;
  return { ...payload, salaryType: setup.basis, pay: setup.pay };
}

/** The schema reports the salary rule on `salaryType`; the input to fix is the amount field. */
const salaryField = (raw: Record<string, unknown>) => (field: string) =>
  field === "salaryType" ? "basicSalary" : field;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const numOr = (v: unknown, fallback: number) => {
  const raw = str(v);
  const n = Number(raw);
  return raw === "" || Number.isNaN(n) ? fallback : n;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(str(v) as T) ? (str(v) as T) : fallback;

type ExistingEmployee = NonNullable<Awaited<ReturnType<typeof prisma.employee.findFirst>>>;

/**
 * An admin's edit is taken as typed: no length / format / "required" rules on
 * the personal data (national ID, phone, address, qualification…), so they can
 * fix or clear anything. Only what the database itself needs to stay
 * consistent is enforced — blank values for the columns that can't be empty
 * keep their current value, and a national ID still can't duplicate another
 * employee's (checked by the caller).
 */
function lenientEmployeePayload(id: string, raw: Record<string, unknown>, before: ExistingEmployee): EmployeePayload {
  const salaryType = oneOf(raw.salaryType, ["monthly", "daily"] as const, before.salaryType);
  const hire = str(raw.hireDate);
  return {
    id,
    name: str(raw.name) || before.name,
    departmentId: str(raw.departmentId) || before.departmentId,
    jobTitle: str(raw.jobTitle) || before.jobTitle,
    hireDate: /^\d{4}-\d{2}-\d{2}$/.test(hire) ? hire : before.hireDate.toISOString().slice(0, 10),
    shiftId: str(raw.shiftId) || before.shiftId,
    salaryType,
    basicSalary: numOr(raw.basicSalary, before.basicSalary),
    dailyRate: numOr(raw.dailyRate, before.dailyRate ?? 0) || undefined,
    dailyWorkingHours: numOr(raw.dailyWorkingHours, before.dailyWorkingHours),
    // the switch is always rendered on this form, so its presence in raw always reflects its real state
    overtimeEligible: raw.overtimeEligible === "on",
    allowances: numOr(raw.allowances, before.allowancesTotal),
    status: oneOf(raw.status, ["active", "on_leave", "terminated"] as const, before.status),
    phone: str(raw.phone) || null,
    address: str(raw.address) || null,
    qualification: str(raw.qualification) || null,
    militaryStatus: oneOf(raw.militaryStatus, ["completed", "exempted", "postponed", "not_applicable"] as const, before.militaryStatus ?? "not_applicable"),
    nationalId: str(raw.nationalId) || null,
    gender: str(raw.gender) === "male" || str(raw.gender) === "female" ? (str(raw.gender) as "male" | "female") : (before.gender ?? undefined),
    // the checkbox is always rendered on this form, so its presence in raw always reflects its real state
    isDriver: raw.isDriver === "on",
  };
}

async function nextEmployeeId() {
  const rows = await prisma.employee.findMany({ select: { id: true } });
  const max = rows.reduce((m, e) => {
    const n = Number(e.id.replace("EMP-", ""));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 1000);
  return `EMP-${max + 1}`;
}

export async function createEmployee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const raw = Object.fromEntries(formData);
  // An unchecked switch is simply absent from FormData, same as a native checkbox — read its true
  // state explicitly so "off" doesn't get mistaken for "not sent" and fall back to the schema default.
  const parsed = employeeSchema.safeParse({
    ...raw,
    overtimeEligible: formData.get("overtimeEligible") === "on",
    isDriver: formData.get("isDriver") === "on",
  });
  if (!parsed.success) return invalidFieldsError(t, parsed.error.issues, salaryField(raw));
  const id = await nextEmployeeId();

  if (await prisma.employee.findUnique({ where: { nationalId: parsed.data.nationalId } })) {
    return { error: t.validation.nationalIdTaken, fields: ["nationalId"] };
  }

  const actor = await getSession();
  const withPay = await withPaySetup({ id, ...parsed.data }, raw);
  if ("fields" in withPay) return invalidFieldsError(t, withPay.fields.map((f) => ({ path: [f] }) as never));
  const payload: EmployeePayload = withPay;

  return gate(
    {
      actionKey: "employees.create",
      module: t.nav.employees,
      actionLabel: t.auditActions.addEmployee,
      summary: payload.name,
    },
    payload,
    () => applyCreateEmployee(payload, actor?.name ?? t.auditActions.system),
  );
}

export async function applyCreateEmployee(payload: EmployeePayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  if (payload.nationalId && (await prisma.employee.findUnique({ where: { nationalId: payload.nationalId } }))) {
    return { error: t.validation.nationalIdTaken, fields: ["nationalId"] };
  }
  const { id, allowances, hireDate, dailyRate, salaryType, nationalId, pay, ...rest } = payload;

  const department = await prisma.department.findUnique({ where: { id: rest.departmentId } });
  if (!department) return { error: t.validation.invalidData };

  await recordChangeAs(
    actorName,
    { module: t.nav.employees, action: t.auditActions.addEmployee, newValue: payload.name },
    async (tx) => {
      const employeeNumber = await generateEmployeeNumber(tx, department.name);
      return tx.employee.create({
        data: {
          id,
          employeeNumber,
          ...rest,
          nationalId,
          salaryType,
          ...(pay ?? {}),
          dailyRate: salaryType === "daily" ? dailyRate ?? null : null,
          hireDate: new Date(`${hireDate}T00:00:00.000Z`),
          allowancesTotal: allowances,
          terminatedAt: rest.status === "terminated" ? new Date() : null,
        },
      });
    },
  );

  revalidatePath("/employees");
  return { success: true, message: t.employees.savedEmployee };
}

export async function updateEmployee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const id = String(formData.get("id") ?? "");
  const actor = await getSession();
  const raw = Object.fromEntries(formData);

  const before = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!before) return { error: t.validation.employeeNotFound };

  let payload: EmployeePayload;
  if (actor?.role === "admin") {
    payload = lenientEmployeePayload(id, raw, before);
    // Structural checks only: the department / shift must exist or the save would crash.
    const [department, shift] = await Promise.all([
      prisma.department.findUnique({ where: { id: payload.departmentId } }),
      prisma.shift.findUnique({ where: { id: payload.shiftId } }),
    ]);
    const missing = [!department && "departmentId", !shift && "shiftId"].filter(Boolean) as string[];
    if (missing.length) return invalidFieldsError(t, missing.map((f) => ({ path: [f] }) as never));
  } else {
    const parsed = employeeSchema.safeParse({
      ...raw,
      overtimeEligible: formData.get("overtimeEligible") === "on",
      isDriver: formData.get("isDriver") === "on",
    });
    if (!parsed.success) return invalidFieldsError(t, parsed.error.issues, salaryField(raw));
    payload = { id, ...parsed.data };
  }

  const withPay = await withPaySetup(payload, raw);
  if ("fields" in withPay) return invalidFieldsError(t, withPay.fields.map((f) => ({ path: [f] }) as never));
  payload = withPay;

  if (payload.nationalId) {
    const nidOwner = await prisma.employee.findUnique({ where: { nationalId: payload.nationalId } });
    if (nidOwner && nidOwner.id !== id) return { error: t.validation.nationalIdTaken, fields: ["nationalId"] };
  }

  const result = await gate(
    {
      actionKey: "employees.update",
      module: t.nav.employees,
      actionLabel: t.auditActions.editEmployee,
      summary: `${before.name} — ${before.basicSalary} EGP → ${payload.name} — ${payload.basicSalary} EGP`,
      targetId: id,
    },
    payload,
    () => applyUpdateEmployee(payload, actor?.name ?? t.auditActions.system),
  );
  // Saved from the employee's profile and the move gave a new number: the old address no longer exists, so
  // the profile reopens at the new one (a request still waiting for approval changes nothing and stays put).
  if (result.employeeNumber && formData.get("onProfile") === "1") redirect(`/employees/${result.employeeNumber}`);
  return result;
}

export async function applyUpdateEmployee(payload: EmployeePayload, actorName: string): Promise<ActionState> {
  const t = await getT();
  const { id, allowances, hireDate, dailyRate, salaryType, nationalId, pay, ...rest } = payload;

  const before = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!before) return { error: t.validation.employeeNotFound };
  if (nationalId) {
    const nidOwner = await prisma.employee.findUnique({ where: { nationalId } });
    if (nidOwner && nidOwner.id !== id) return { error: t.validation.nationalIdTaken, fields: ["nationalId"] };
  }

  const audit = {
    module: t.nav.employees,
    action: t.auditActions.editEmployee,
    oldValue: `${before.name} — ${before.basicSalary} EGP`,
    newValue: `${payload.name} — ${payload.basicSalary} EGP`,
  };
  let renumbered: { from: string; to: string } | null = null;
  try {
    await recordChangeAs(actorName, audit, async (tx) => {
      // A real move to another department gives the employee that department's next number, claimed in this
      // same transaction (and only now: a request waiting for approval reserves nothing). Read here, not from
      // `before`, so the comparison is against what is saved at this moment.
      const current = await tx.employee.findUniqueOrThrow({ where: { id }, select: { departmentId: true, employeeNumber: true } });
      let employeeNumber: string | undefined;
      if (rest.departmentId !== current.departmentId) {
        const [from, to] = await Promise.all([
          tx.department.findUnique({ where: { id: current.departmentId }, select: { name: true } }),
          tx.department.findUniqueOrThrow({ where: { id: rest.departmentId }, select: { name: true } }),
        ]);
        employeeNumber = await nextFreeEmployeeNumber(tx, to.name);
        renumbered = { from: current.employeeNumber, to: employeeNumber };
        // department and number, old → new, on the same audit row (recordChangeAs writes it after this returns)
        audit.oldValue += ` — ${from?.name ?? current.departmentId} (${current.employeeNumber})`;
        audit.newValue += ` — ${to.name} (${employeeNumber})`;
      }
      const updated = await tx.employee.update({
        where: { id },
        data: {
          ...rest,
          ...(employeeNumber ? { employeeNumber } : {}),
          nationalId,
          salaryType,
          ...(pay ?? {}),
          dailyRate: salaryType === "daily" ? dailyRate ?? null : null,
          hireDate: new Date(`${hireDate}T00:00:00.000Z`),
          allowancesTotal: allowances,
          // The end-of-service date follows the status: stamped when it becomes terminated (an employee who
          // already was keeps their original date), cleared the moment it is anything else.
          terminatedAt: rest.status === "terminated" ? (before.status === "terminated" ? before.terminatedAt ?? new Date() : new Date()) : null,
          // Only a terminated employee can be archived: any other status clears an archive done by hand, and
          // becoming terminated starts without one (an employee who stays terminated keeps theirs).
          ...(before.status === "terminated" && rest.status === "terminated" ? {} : { archivedAt: null }),
          // Ending someone's service frees their fingerprint-device link in the same write. Only the link:
          // their attendance, pay and files stay exactly as they were. (The device itself is not contacted.)
          ...(deviceLinkClearOnTermination(before, rest.status) ?? {}),
        },
      });
      if (deviceLinkClearOnTermination(before, rest.status)) {
        await writeAudit(
          tx,
          {
            module: t.nav.biometricDevice,
            action: t.auditActions.unlinkDeviceOnTermination,
            oldValue: `${before.name} (${before.employeeNumber}) — ${before.biometricDeviceUserId}`,
            newValue: "-",
            reason: t.employees.statusTerminated,
          },
          actorName,
        );
      }
      await freezeLinkedAccountIfInactive(tx, id, updated.status);
      return updated;
    });
  } catch (e) {
    // the unique index (or the skip-taken loop) refused the number: nothing was saved, say so plainly
    const duplicate =
      e instanceof EmployeeNumberTakenError ||
      (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && String(e.meta?.target ?? "").includes("employeeNumber"));
    if (duplicate) return { error: t.employees.numberTaken, fields: ["departmentId"] };
    throw e;
  }

  revalidatePath("/employees");
  revalidatePath(`/employees/${before.employeeNumber}`);
  const moved = renumbered as { from: string; to: string } | null;
  if (moved) revalidatePath(`/employees/${moved.to}`);
  // salary, pay type or schedule may have changed: days not yet approved follow the new setup
  refreshPayCalculations();
  // the new number lets an open profile page move to its new address
  return { success: true, message: t.employees.savedEdits, ...(moved ? { employeeNumber: moved.to } : {}) };
}

/**
 * terminated freezes any linked login (User.active = false) so
 * permissions/access stop immediately — reactivating the employee later does
 * NOT auto-restore login access, an admin must re-enable it explicitly.
 */
async function freezeLinkedAccountIfInactive(
  tx: TransactionClient,
  employeeId: string,
  status: string,
) {
  if (status !== "terminated") return;
  await tx.user.updateMany({ where: { employeeId, active: true }, data: { active: false } });
}

/**
 * Archive / unarchive an employee by hand. Both are ordinary edits, not deletes: they go through gate() (an
 * "اداري" account's request waits for the admin unless it has directEdit), are audited old → new, and never
 * touch the employee's attendance, pay or files. They need the same grant as editing an employee.
 */
async function archiveAllowed() {
  const actor = await getSession();
  return actor && hasPermission(actor, "employees") ? actor : null;
}

export async function archiveEmployee(id: string): Promise<ActionState> {
  const t = await getT();
  const actor = await archiveAllowed();
  if (!actor) return { error: t.validation.notAllowed };
  const employee = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };
  if (isArchived(employee)) return { error: t.employees.alreadyArchived };
  if (!canArchive(employee)) return { error: t.employees.archiveOnlyTerminated };

  return gate(
    {
      actionKey: "employees.archive",
      module: t.nav.employees,
      actionLabel: t.auditActions.archiveEmployee,
      summary: `${employee.name} (${employee.employeeNumber})`,
      targetId: id,
    },
    { id },
    () => applyArchiveEmployee({ id }, actor.name),
  );
}

export async function applyArchiveEmployee(payload: { id: string }, actorName: string): Promise<ActionState> {
  const t = await getT();
  const employee = await prisma.employee.findFirst({ where: { id: payload.id, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };
  if (isArchived(employee)) return { error: t.employees.alreadyArchived };
  // checked again here: a queued request may be approved after the employee's status changed
  if (!canArchive(employee)) return { error: t.employees.archiveOnlyTerminated };

  await recordChangeAs(
    actorName,
    {
      module: t.nav.employees,
      action: t.auditActions.archiveEmployee,
      oldValue: t.employees.notArchived,
      newValue: t.employees.archivedBadge,
      reason: `${employee.name} (${employee.employeeNumber})`,
    },
    (tx) => tx.employee.update({ where: { id: employee.id }, data: { archivedAt: new Date() } }),
  );

  revalidatePath("/employees");
  revalidatePath(`/employees/${employee.employeeNumber}`);
  return { success: true, message: t.employees.archivedEmployee };
}

export async function unarchiveEmployee(id: string): Promise<ActionState> {
  const t = await getT();
  const actor = await archiveAllowed();
  if (!actor) return { error: t.validation.notAllowed };
  const employee = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };
  // an archive done by the one-month rule has no switch to turn off: the employee comes back when the status changes
  if (!employee.archivedAt || employee.status !== "terminated") return { error: t.employees.unarchiveByStatus };

  return gate(
    {
      actionKey: "employees.unarchive",
      module: t.nav.employees,
      actionLabel: t.auditActions.unarchiveEmployee,
      summary: `${employee.name} (${employee.employeeNumber})`,
      targetId: id,
    },
    { id },
    () => applyUnarchiveEmployee({ id }, actor.name),
  );
}

export async function applyUnarchiveEmployee(payload: { id: string }, actorName: string): Promise<ActionState> {
  const t = await getT();
  const employee = await prisma.employee.findFirst({ where: { id: payload.id, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };
  if (!employee.archivedAt || employee.status !== "terminated") return { error: t.employees.unarchiveByStatus };

  await recordChangeAs(
    actorName,
    {
      module: t.nav.employees,
      action: t.auditActions.unarchiveEmployee,
      oldValue: t.employees.archivedBadge,
      newValue: t.employees.notArchived,
      reason: `${employee.name} (${employee.employeeNumber})`,
    },
    (tx) => tx.employee.update({ where: { id: employee.id }, data: { archivedAt: null } }),
  );

  revalidatePath("/employees");
  revalidatePath(`/employees/${employee.employeeNumber}`);
  return { success: true, message: t.employees.unarchivedEmployee };
}
