import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Leave } from "@/lib/types";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { APP_TIME_ZONE, format } from "@/lib/i18n/format";
import { leaveTypeLabel } from "@/lib/i18n/labels";
import { isApprovedLeave } from "@/lib/leave-paper";
import { PrintButton } from "@/components/payroll/print-button";

/** The day a request was made, in Egypt's time zone, written like the leave's own dates (yyyy-MM-dd). */
const requestDay = (createdAt: string) =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: APP_TIME_ZONE }).format(new Date(createdAt));

/**
 * One leave request on a plain sheet to print and sign: the employee, the leave, its status, and a signature line for
 * the employee and one for management. No company branding, on screen or printed (like the payslip). A request that
 * is not approved carries a bold "not approved" banner that stays on the printed page, so it can't pass for a leave.
 */
export function LeavePaper({
  t,
  leave,
  employee,
  days,
}: {
  t: Dictionary;
  leave: Leave;
  employee: { name: string; employeeNumber: string };
  days: { calendar: number; charged: number | null };
}) {
  const p = t.leavePaper;
  const approved = isApprovedLeave(leave);
  const statusLabel = leave.status === "approved" ? p.statusApproved : leave.status === "rejected" ? p.statusRejected : p.statusPending;
  const banner = leave.status === "rejected" ? p.bannerRejected : p.bannerPending;

  return (
    <div className="min-h-screen bg-white py-8 print:py-0">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4">
        <div className="flex items-center justify-between no-print">
          <Link href="/leaves" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowRight className="h-4 w-4 rtl:rotate-180" />
            {p.back}
          </Link>
          <PrintButton label={p.print} />
        </div>

        <div className="rounded-lg border border-border bg-white p-8 print:border-none print:p-0">
          <div className="border-b border-border pb-6">
            <p className="text-lg font-bold text-foreground">{p.title}</p>
          </div>

          {/* not an approved leave: bold, bordered (a border prints where a background colour may not), never hidden in print */}
          {!approved && (
            <div data-testid="leave-not-approved" role="alert" className="my-6 border-4 border-black p-4 text-center text-xl font-extrabold text-black">
              {banner}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 border-b border-border py-6 text-sm">
            <Field label={p.employeeName} value={employee.name} />
            <Field label={p.employeeId} value={employee.employeeNumber} ltr />
            <Field label={p.leaveType} value={leaveTypeLabel(leave.type, t)} />
            <Field label={p.requestDate} value={requestDay(leave.createdAt)} ltr />
            <Field label={p.from} value={leave.from} ltr />
            <Field label={p.to} value={leave.to} ltr />
            <Field label={p.days} value={String(days.calendar)} ltr />
            {days.charged !== null && days.charged !== days.calendar && <Field label={p.chargedDays} value={`${days.charged} — ${p.chargedDaysNote}`} />}
            {leave.startTime && leave.durationMinutes ? (
              <Field label={p.time} value={format(t.leaves.timeAndDuration, { start: leave.startTime, duration: leave.durationMinutes })} ltr />
            ) : null}
          </div>

          <div className="flex flex-col gap-4 border-b border-border py-6 text-sm">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{p.reason}</span>
              <span className="min-h-[2.5rem] whitespace-pre-wrap font-medium text-foreground">{leave.reason.trim() || "—"}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{p.status}</span>
              <span data-testid="leave-status" className={`rounded border-2 border-black px-3 py-1 text-base font-bold text-black ${approved ? "" : "uppercase"}`}>
                {statusLabel}
              </span>
              {approved && leave.approvedBy && (
                <span className="text-xs text-muted-foreground">
                  {p.approvedBy}: {leave.approvedBy}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-10 pt-12 text-sm">
            <Signature label={p.signatureEmployee} date={p.signatureDate} />
            <Signature label={p.signatureManagement} date={p.signatureDate} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span dir={ltr ? "ltr" : undefined} className={`font-medium text-foreground ${ltr ? "text-start" : ""}`}>{value}</span>
    </div>
  );
}

function Signature({ label, date }: { label: string; date: string }) {
  return (
    <div className="flex flex-col gap-8">
      <span className="font-medium text-foreground">{label}</span>
      <div className="border-b border-black" />
      <div className="flex items-end gap-2 text-xs text-muted-foreground">
        <span>{date}</span>
        <div className="flex-1 border-b border-black" />
      </div>
    </div>
  );
}
