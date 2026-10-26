import type { ToolContext } from "@/lib/assistant/employee-tools";
import { codeIfNeeded, resolveEmployee } from "@/lib/assistant/employee-tools";
import { DRAFT_PAGES, type DraftKind, type DraftValues } from "@/lib/assistant/drafts";
import { clip, isDay, str } from "@/lib/assistant/system-tools";
import { deductionTypeLabel, leaveTypeLabel } from "@/lib/i18n/labels";
import type { DeductionType, Employee, LeaveType } from "@/lib/types";

// The one tool that gets something done: it fills in a form for the admin. It saves nothing in the system. It
// keeps the filled-in form for a short while and returns a link; the admin opens it, sees the form already
// filled in on its page, and presses save himself.

const LEAVE_TYPES: LeaveType[] = ["annual", "casual", "sick", "unpaid", "mission", "permission", "excused_absence"];
const DEDUCTION_TYPES: DeductionType[] = ["late", "absence", "early_leave", "permission", "unauthorized_exit", "penalty", "advance", "admin_deduction", "other"];
const FORMS: DraftKind[] = ["leave", "overtime", "deduction", "work_request"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const PREPARE_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "prepare_form",
      description:
        "Fills in a form for the admin to review: a leave request, an overtime entry, a deduction or a work request (like staying late). It does NOT save anything: it returns a link that opens the page with the form already filled in, and the admin presses save. Use it when the admin asks to add or request one of these. Give every detail you were told; if something required is missing, the result lists it, so ask the admin for it. Use the exact link it returns.",
      parameters: {
        type: "object",
        properties: {
          form: { type: "string", enum: FORMS, description: "leave = leave request; overtime = overtime entry; deduction = deduction or penalty; work_request = a request for workers to stay late or similar." },
          employee: { type: "string", description: "leave, overtime, deduction: the employee's name or number." },
          employees: { type: "array", items: { type: "string" }, description: "work_request: the workers' names or numbers." },
          type: { type: "string", description: `leave: ${LEAVE_TYPES.join(" | ")} (default annual). deduction: ${DEDUCTION_TYPES.join(" | ")} (default penalty). work_request: late_work | other (default late_work).` },
          from: { type: "string", description: "leave: first day, yyyy-MM-dd (default today)." },
          to: { type: "string", description: "leave: last day, yyyy-MM-dd (default the first day)." },
          date: { type: "string", description: "overtime, deduction, work_request: the day, yyyy-MM-dd (default today, except work_request where it is required)." },
          reason: { type: "string", description: "leave: the reason (optional). deduction: the reason (required)." },
          hours: { type: "number", description: "overtime: hours (default 2)." },
          hourly_rate: { type: "number", description: "overtime: pay per hour, only if the admin gave one; otherwise the employee's usual rate is used." },
          amount: { type: "number", description: "deduction: the amount in pounds (required)." },
          notes: { type: "string", description: "overtime, deduction: optional notes." },
          from_time: { type: "string", description: "work_request: start time HH:MM (required for late_work)." },
          to_time: { type: "string", description: "work_request: end time HH:MM (required for late_work)." },
          details: { type: "string", description: "work_request: what is needed (required)." },
        },
        required: ["form"],
      },
    },
  },
] as const;

type Args = Record<string, unknown>;

const missing = (...fields: string[]) => ({ ok: false, saved: false, missing: fields, message: "Ask the admin for these details, then call this again. Nothing was prepared." });

/** One person from a name or number, or the reply to give when it is not exactly one. */
function pick(ctx: ToolContext, query: string | undefined): { e: Employee } | { reply: unknown } {
  if (!query) return { reply: missing("employee") };
  const { one, candidates } = resolveEmployee(ctx, query);
  if (one) return { e: one };
  if (candidates?.length) {
    return {
      reply: {
        ok: false,
        saved: false,
        ambiguous: true,
        message: "More than one employee matches. Ask the admin which one (or use the employee number).",
        candidates: candidates.slice(0, 10).map((e) => ({ employeeNumber: e.employeeNumber, name: e.name })),
      },
    };
  }
  return { reply: { ok: false, saved: false, message: `No employee matches "${clip(query, 40)}".` } };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);

function finish(ctx: ToolContext, kind: DraftKind, values: DraftValues, summary: Record<string, unknown>) {
  if (!ctx.drafts) return { ok: false, saved: false, message: "Preparing forms is not available right now." };
  const id = ctx.drafts.save({ kind, values });
  return {
    ok: true,
    saved: false,
    page: DRAFT_PAGES[kind],
    link: `${DRAFT_PAGES[kind]}?assistant=${id}`,
    prepared: summary,
    note: "Nothing is saved yet. The link opens the page with this form filled in; the admin reviews it and presses save himself. Tell the admin what was prepared, then give the link.",
  };
}

export function prepareForm(ctx: ToolContext, a: Args) {
  const form = str(a.form) as DraftKind | undefined;
  if (!form || !FORMS.includes(form)) return { ok: false, message: `form must be one of: ${FORMS.join(", ")}.` };
  const bad = (field: string, why: string) => ({ ok: false, saved: false, message: `${field}: ${why}` });

  if (form === "work_request") {
    const type = a.type === "other" ? "other" : "late_work";
    const names = Array.isArray(a.employees) ? a.employees.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
    const date = isDay(a.date) ? a.date : undefined;
    const details = str(a.details);
    const fromTime = str(a.from_time);
    const toTime = str(a.to_time);
    const lacks = [!names.length && "employees", !date && "date", !details && "details", type === "late_work" && !fromTime && "from_time", type === "late_work" && !toTime && "to_time"].filter(Boolean) as string[];
    if (lacks.length) return missing(...lacks);
    if ((fromTime && !TIME.test(fromTime)) || (toTime && !TIME.test(toTime))) return bad("from_time/to_time", "use HH:MM, like 18:00.");
    const people: Employee[] = [];
    for (const n of names) {
      const r = pick(ctx, n);
      if ("reply" in r) return r.reply;
      if (!people.includes(r.e)) people.push(r.e);
    }
    return finish(ctx, form, { type, date, fromTime, toTime, employeeIds: people.map((e) => e.id), details }, {
      request: type === "late_work" ? "staying late" : "other request",
      day: date,
      from: fromTime ?? null,
      to: toTime ?? null,
      workers: people.map((e) => ({ ...codeIfNeeded(ctx, e), name: e.name })),
      details: clip(details, 200),
    });
  }

  const who = pick(ctx, str(a.employee));
  if ("reply" in who) return who.reply;
  const e = who.e;
  const person = { ...codeIfNeeded(ctx, e), name: e.name };

  if (form === "leave") {
    const type = (str(a.type) ?? "annual") as LeaveType;
    if (!LEAVE_TYPES.includes(type)) return bad("type", `use one of: ${LEAVE_TYPES.join(", ")}.`);
    const from = isDay(a.from) ? a.from : ctx.today;
    const to = isDay(a.to) ? a.to : from;
    if (to < from) return bad("to", "the last day is before the first day.");
    const reason = str(a.reason);
    return finish(ctx, form, { employeeId: e.id, type, from, to, reason }, { employee: person, type: leaveTypeLabel(type, ctx.t), from, to, reason: reason ? clip(reason, 200) : null });
  }

  if (form === "overtime") {
    const hours = num(a.hours) ?? 2;
    if (hours <= 0 || hours > 24) return bad("hours", "must be more than 0 and at most 24.");
    const rate = num(a.hourly_rate);
    if (rate !== undefined && rate < 0) return bad("hourly_rate", "cannot be negative.");
    const date = isDay(a.date) ? a.date : ctx.today;
    const notes = str(a.notes);
    return finish(ctx, form, { employeeId: e.id, date, hours, hourlyRate: rate, notes }, { employee: person, day: date, hours, hourlyRate: rate ?? "the employee's usual rate", notes: notes ? clip(notes, 200) : null });
  }

  // deduction
  const type = (str(a.type) ?? "penalty") as DeductionType;
  if (!DEDUCTION_TYPES.includes(type)) return bad("type", `use one of: ${DEDUCTION_TYPES.join(", ")}.`);
  const amount = num(a.amount);
  const reason = str(a.reason);
  const lacks = [(amount === undefined || amount <= 0) && "amount", !reason && "reason"].filter(Boolean) as string[];
  if (lacks.length) return missing(...lacks);
  const date = isDay(a.date) ? a.date : ctx.today;
  const notes = str(a.notes);
  return finish(ctx, "deduction", { employeeId: e.id, type, amount, date, reason, notes }, { employee: person, type: deductionTypeLabel(type, ctx.t), amount, day: date, reason: clip(reason, 200), notes: notes ? clip(notes, 200) : null });
}

/** Runs this tool, or returns undefined when the name isn't it. */
export function executePrepareTool(name: string, args: unknown, ctx: ToolContext): unknown {
  if (name !== "prepare_form") return undefined;
  return prepareForm(ctx, (args && typeof args === "object" ? args : {}) as Args);
}
