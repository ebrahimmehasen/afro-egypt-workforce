"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { recordChange } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { canManageApplications } from "@/lib/permissions";
import { ActionState } from "@/hooks/use-action-feedback";
import { getT } from "@/lib/i18n";
import { APPLICATION_STATUSES } from "@/lib/recruitment/config";
import { DEFAULT_FIELDS, DEFAULT_KEYS, resolveFormConfig, type FieldType, type FormFieldRow } from "@/lib/recruitment/form-config";
import { formFieldSchema, isValidCustomKey, jobSchema, newQuestionSchema, parseOptionLines } from "@/lib/recruitment/validation";

// Everything HR does with applications, jobs and the public form. Each action re-checks on the server that the caller is the
// admin or HR holding the employees grant (the same audience as the employee files; no new permission, no wider audience),
// and writes its audit entry in the same transaction. None of them touches an employee, payroll or attendance.

const flag = (v: FormDataEntryValue | null) => v === "on" || v === "true" || v === "1";

async function authorize() {
  const user = await getSession();
  const t = await getT();
  if (!user || !canManageApplications(user)) return { t, user: null } as const;
  return { t, user } as const;
}

function refresh() {
  revalidatePath("/employees/applications");
  revalidatePath("/employees/jobs");
  revalidatePath("/employees/applications/form");
  revalidatePath("/apply");
  revalidatePath("/audit-log");
}

export async function updateApplication(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t, user } = await authorize();
  if (!user) return { error: t.validation.notAllowed };
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!id || !(APPLICATION_STATUSES as readonly string[]).includes(status) || note.length > 4000) return { error: t.validation.invalidData };

  const application = await prisma.jobApplication.findUnique({ where: { id }, include: { jobOpening: true } });
  if (!application) return { error: t.recruitment.admin.notFound };
  await recordChange(
    {
      module: t.nav.employees,
      action: t.auditActions.updateApplication,
      oldValue: `${application.fullName} — ${t.recruitment.admin.statuses[application.status]}`,
      newValue: `${t.recruitment.admin.statuses[status as keyof typeof t.recruitment.admin.statuses]}${note ? ` — ${note}` : ""}`,
      reason: application.jobOpening.title,
    },
    (tx) => tx.jobApplication.update({ where: { id }, data: { status: status as (typeof APPLICATION_STATUSES)[number], note: note || null } }),
  );
  refresh();
  return { success: true, message: t.recruitment.admin.saved };
}

export async function saveJob(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t, user } = await authorize();
  if (!user) return { error: t.validation.notAllowed };
  const parsed = jobSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    open: flag(formData.get("open")),
    salaryMin: formData.get("salaryMin") ?? "",
    salaryMax: formData.get("salaryMax") ?? "",
    showSalary: flag(formData.get("showSalary")),
    sortOrder: formData.get("sortOrder") || 0,
  });
  if (!parsed.success) {
    const salaryOrder = parsed.error.issues.some((i) => i.path[0] === "salaryMax" && i.code === "custom");
    return { error: salaryOrder ? t.recruitment.admin.jobs.salaryOrder : t.recruitment.admin.jobs.invalid, fields: parsed.error.issues.map((i) => String(i.path[0])) };
  }
  const id = String(formData.get("id") ?? "");
  const data = { ...parsed.data, description: parsed.data.description ?? null, salaryMin: parsed.data.salaryMin ?? null, salaryMax: parsed.data.salaryMax ?? null };
  const summary = `${data.title} — ${data.open ? t.recruitment.admin.jobs.openBadge : t.recruitment.admin.jobs.closedBadge}`;

  if (id) {
    const existing = await prisma.jobOpening.findUnique({ where: { id } });
    if (!existing) return { error: t.recruitment.admin.notFound };
    await recordChange(
      { module: t.nav.employees, action: t.auditActions.editJob, oldValue: `${existing.title} — ${existing.open ? t.recruitment.admin.jobs.openBadge : t.recruitment.admin.jobs.closedBadge}`, newValue: summary },
      (tx) => tx.jobOpening.update({ where: { id }, data }),
    );
  } else {
    await recordChange({ module: t.nav.employees, action: t.auditActions.createJob, newValue: summary }, (tx) => tx.jobOpening.create({ data }));
  }
  refresh();
  return { success: true, message: t.recruitment.admin.saved };
}

/** The row to store for a default field (its type never changes) or an existing custom one. */
async function rowFor(key: string): Promise<FormFieldRow | null> {
  const row = await prisma.formField.findUnique({ where: { key } });
  if (row) return row as unknown as FormFieldRow;
  const def = DEFAULT_FIELDS.find((f) => f.key === key);
  return def ? { key, labelAr: def.labelAr, labelEn: def.labelEn, type: def.type, options: [], required: def.required, visible: def.visible, sortOrder: def.sortOrder, builtin: def.builtin } : null;
}

/** Edit one field of the form: its labels, flags, order and (for a select) options. The core fields stay shown and required. */
export async function saveFormField(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t, user } = await authorize();
  if (!user) return { error: t.validation.notAllowed };
  const parsed = formFieldSchema.safeParse({
    key: formData.get("key"),
    labelAr: formData.get("labelAr"),
    labelEn: formData.get("labelEn"),
    required: flag(formData.get("required")),
    visible: flag(formData.get("visible")),
    sortOrder: formData.get("sortOrder") || 0,
    optionsText: String(formData.get("optionsText") ?? ""),
  });
  if (!parsed.success) return { error: t.recruitment.admin.form.invalid, fields: parsed.error.issues.map((i) => String(i.path[0])) };
  const current = await rowFor(parsed.data.key);
  if (!current) return { error: t.recruitment.admin.notFound };

  const core = DEFAULT_FIELDS.find((f) => f.key === current.key)?.builtin ?? false;
  const options = current.type === "select" && !DEFAULT_KEYS.has(current.key) ? parseOptionLines(parsed.data.optionsText ?? "") : [];
  if (current.type === "select" && !DEFAULT_KEYS.has(current.key) && options.length < 2) return { error: t.recruitment.admin.form.needOptions, fields: ["optionsText"] };

  const data = {
    labelAr: parsed.data.labelAr,
    labelEn: parsed.data.labelEn,
    // a core field can never be hidden or made optional, whatever was posted
    required: core ? true : parsed.data.required,
    visible: core ? true : parsed.data.visible,
    sortOrder: parsed.data.sortOrder,
    ...(options.length > 0 ? { options } : {}),
  };
  await recordChange(
    {
      module: t.nav.employees,
      action: t.auditActions.editFormField,
      oldValue: `${current.labelAr} — ${current.visible ? "✓" : "✗"} ${current.required ? "*" : ""}`,
      newValue: `${data.labelAr} — ${data.visible ? "✓" : "✗"} ${data.required ? "*" : ""}`,
    },
    (tx) =>
      tx.formField.upsert({
        where: { key: current.key },
        update: data,
        create: { key: current.key, type: current.type as FieldType, builtin: core, ...data },
      }),
  );
  refresh();
  return { success: true, message: t.recruitment.admin.saved };
}

/** Add an extra question. Its key is generated, so it can never collide with a default field or a name the form uses. */
export async function addFormQuestion(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { t, user } = await authorize();
  if (!user) return { error: t.validation.notAllowed };
  const parsed = newQuestionSchema.safeParse({
    labelAr: formData.get("labelAr"),
    labelEn: formData.get("labelEn"),
    type: formData.get("type"),
    required: flag(formData.get("required")),
    visible: true,
    sortOrder: 0,
    optionsText: String(formData.get("optionsText") ?? ""),
  });
  if (!parsed.success) return { error: t.recruitment.admin.form.invalid, fields: parsed.error.issues.map((i) => String(i.path[0])) };
  const options = parsed.data.type === "select" ? parseOptionLines(parsed.data.optionsText ?? "") : [];
  if (parsed.data.type === "select" && options.length < 2) return { error: t.recruitment.admin.form.needOptions, fields: ["optionsText"] };

  const last = await prisma.formField.aggregate({ _max: { sortOrder: true } });
  const sortOrder = Math.max(last._max.sortOrder ?? 0, ...DEFAULT_FIELDS.map((f) => f.sortOrder)) + 10;
  const key = `q_${randomBytes(4).toString("hex")}`;
  await recordChange(
    { module: t.nav.employees, action: t.auditActions.addFormQuestion, newValue: `${parsed.data.labelAr} / ${parsed.data.labelEn} (${t.recruitment.admin.form.types[parsed.data.type as FieldType]})` },
    (tx) =>
      tx.formField.create({
        data: { key, labelAr: parsed.data.labelAr, labelEn: parsed.data.labelEn, type: parsed.data.type as FieldType, options: options.length > 0 ? options : undefined, required: parsed.data.required, visible: true, sortOrder, builtin: false },
      }),
  );
  refresh();
  return { success: true, message: t.recruitment.admin.saved };
}

/** Remove an extra question. A default or core field cannot be removed (a default is only hidden). Earlier answers stay stored. */
export async function removeFormQuestion(key: string): Promise<ActionState> {
  const { t, user } = await authorize();
  if (!user) return { error: t.validation.notAllowed };
  if (!isValidCustomKey(key)) return { error: t.validation.notAllowed };
  const row = await prisma.formField.findUnique({ where: { key } });
  if (!row || row.builtin) return { error: t.recruitment.admin.notFound };
  await recordChange({ module: t.nav.employees, action: t.auditActions.removeFormQuestion, oldValue: `${row.labelAr} / ${row.labelEn}` }, (tx) => tx.formField.delete({ where: { key } }));
  refresh();
  return { success: true, message: t.recruitment.admin.saved };
}

/** Move a field one place up or down in the form: the order is rewritten 10, 20, 30... for every field. */
export async function moveFormField(key: string, direction: "up" | "down"): Promise<ActionState> {
  const { t, user } = await authorize();
  if (!user) return { error: t.validation.notAllowed };
  const rows = (await prisma.formField.findMany()) as unknown as FormFieldRow[];
  const config = resolveFormConfig(rows);
  const index = config.findIndex((f) => f.key === key);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= config.length) return { success: true };
  [config[index], config[target]] = [config[target], config[index]];
  await recordChange(
    { module: t.nav.employees, action: t.auditActions.editFormField, newValue: `${config[target].labelAr} ${direction === "up" ? "↑" : "↓"}` },
    async (tx) => {
      for (const [i, f] of config.entries()) {
        const sortOrder = (i + 1) * 10;
        if (f.sortOrder === sortOrder && rows.some((r) => r.key === f.key)) continue;
        await tx.formField.upsert({
          where: { key: f.key },
          update: { sortOrder },
          create: { key: f.key, labelAr: f.labelAr, labelEn: f.labelEn, type: f.type, options: f.options.length > 0 ? f.options : undefined, required: f.required, visible: f.visible, sortOrder, builtin: f.builtin },
        });
      }
    },
  );
  refresh();
  return { success: true };
}
