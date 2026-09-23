"use client";

import { Bot, Hand } from "lucide-react";
import { Deduction, Employee, Overtime } from "@/lib/types";
import { formatEGP } from "@/lib/constants";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { intlLocale } from "@/lib/i18n/format";
import { deductionTypeLabel, overtimeKindLabel, requestStatusLabel } from "@/lib/i18n/labels";
import { translateLabel } from "@/lib/i18n/data-labels";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AttendanceStatusBadge } from "@/components/shared/status-badge";

/** That day's attendance, for the row's own date — the punches the entry was calculated from. */
export interface EntryDay {
  actualIn: string | null;
  actualOut: string | null;
  status: string;
  lateMinutes: number;
  workedMinutes: number;
  scheduledStart: string;
  scheduledEnd: string;
}

/** Everything the deductions / overtime lists know about one row, keyed by the row's id. */
export interface EntryContext {
  employee?: Employee;
  department?: string;
  payType?: string;
  day?: EntryDay;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2 last:border-0 sm:flex-row sm:items-start sm:gap-3">
      <span className="text-xs text-muted-foreground sm:w-44 sm:shrink-0">{label}</span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col">
      <p className="mb-1 text-sm font-semibold text-muted-foreground">{title}</p>
      {children}
    </section>
  );
}

function useParts(ctx: EntryContext) {
  const t = useT();
  const locale = useLocale();
  const timeFmt = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit" }) : "—";
  const stampFmt = (iso: string) => new Date(iso).toLocaleString(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" });

  const employee = (
    <Section title={t.entryDetails.sectionEmployee}>
      <Row label={t.entryDetails.employee}>
        {ctx.employee?.name ?? "—"}
        {ctx.employee && <span dir="ltr" className="ms-2 text-xs text-muted-foreground">{ctx.employee.employeeNumber}</span>}
      </Row>
      {ctx.department && <Row label={t.entryDetails.department}>{translateLabel(ctx.department, locale)}</Row>}
      {ctx.employee?.jobTitle && <Row label={t.entryDetails.jobTitle}>{translateLabel(ctx.employee.jobTitle, locale)}</Row>}
      {ctx.payType && <Row label={t.entryDetails.payType}>{ctx.payType}</Row>}
    </Section>
  );

  const day = (
    <Section title={t.entryDetails.sectionDay}>
      {ctx.day ? (
        <>
          <Row label={t.entryDetails.checkIn}>{timeFmt(ctx.day.actualIn)}</Row>
          <Row label={t.entryDetails.checkOut}>{timeFmt(ctx.day.actualOut)}</Row>
          <Row label={t.entryDetails.scheduled}>
            <span dir="ltr">{timeFmt(ctx.day.scheduledStart)} → {timeFmt(ctx.day.scheduledEnd)}</span>
          </Row>
          <Row label={t.entryDetails.workedHours}>{round2(ctx.day.workedMinutes / 60)}</Row>
          <Row label={t.entryDetails.lateMinutes}>{ctx.day.lateMinutes || "—"}</Row>
          <Row label={t.entryDetails.dayStatus}><AttendanceStatusBadge status={ctx.day.status as never} /></Row>
        </>
      ) : (
        <p className="py-2 text-sm text-muted-foreground">{t.entryDetails.noDay}</p>
      )}
    </Section>
  );

  return { t, locale, timeFmt, stampFmt, employee, day };
}

function SourceRows({
  auto,
  editedBy,
  removed,
  createdAt,
  stampFmt,
}: {
  auto: boolean;
  editedBy?: string;
  removed?: boolean;
  createdAt: string;
  stampFmt: (iso: string) => string;
}) {
  const t = useT();
  return (
    <Section title={t.entryDetails.sectionHistory}>
      <Row label={t.entryDetails.source}>
        <span className="flex items-center gap-1.5">
          {auto ? <Bot className="h-4 w-4 text-primary" /> : <Hand className="h-4 w-4 text-muted-foreground" />}
          {auto ? t.entryDetails.sourceSystem : t.entryDetails.sourceManual}
        </span>
      </Row>
      {editedBy && <Row label={t.entryDetails.editedBy}>{editedBy}</Row>}
      {removed && <Row label={t.entryDetails.status}><Badge variant="outline">{t.entryDetails.removed}</Badge></Row>}
      <Row label={t.entryDetails.createdAt}>{stampFmt(createdAt)}</Row>
    </Section>
  );
}

/** Everything about one deduction: what it is, the day it came from, and who changed it since. */
export function DeductionDetailsDialog({
  deduction,
  ctx,
  onClose,
}: {
  deduction: Deduction | null;
  ctx: EntryContext;
  onClose: () => void;
}) {
  const { t, locale, stampFmt, employee, day } = useParts(ctx);
  if (!deduction) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.entryDetails.deductionTitle}</DialogTitle>
          <DialogDescription>{t.entryDetails.hint}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Section title={t.entryDetails.sectionEntry}>
            <Row label={t.entryDetails.type}><Badge variant="destructive">{deductionTypeLabel(deduction.type, t)}</Badge></Row>
            <Row label={t.entryDetails.amount}>
              <span className="font-semibold text-destructive">-{formatEGP(deduction.amount, locale)}</span>
            </Row>
            {deduction.originalAmount != null && deduction.originalAmount !== deduction.amount && (
              <Row label={t.entryDetails.originalAmount}>{formatEGP(deduction.originalAmount, locale)}</Row>
            )}
            <Row label={t.entryDetails.date}>{deduction.date}</Row>
            <Row label={t.entryDetails.reason}>{deduction.reason}</Row>
            {deduction.notes && <Row label={t.entryDetails.notes}>{deduction.notes}</Row>}
          </Section>
          {employee}
          {day}
          <SourceRows auto={Boolean(deduction.autoGenerated)} editedBy={deduction.editedBy} createdAt={deduction.createdAt} stampFmt={stampFmt} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Everything about one addition (overtime, day-off or holiday work, Thursday time). */
export function OvertimeDetailsDialog({
  overtime,
  ctx,
  onClose,
}: {
  overtime: Overtime | null;
  ctx: EntryContext;
  onClose: () => void;
}) {
  const { t, locale, stampFmt, employee, day } = useParts(ctx);
  if (!overtime) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.entryDetails.overtimeTitle}</DialogTitle>
          <DialogDescription>{t.entryDetails.hint}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Section title={t.entryDetails.sectionEntry}>
            <Row label={t.entryDetails.kind}><Badge variant="secondary">{overtimeKindLabel(overtime.kind, t)}</Badge></Row>
            <Row label={t.entryDetails.hours}>{overtime.hours}</Row>
            {overtime.multiplier != null && <Row label={t.entryDetails.multiplier}>× {overtime.multiplier}</Row>}
            <Row label={t.entryDetails.rate}>{formatEGP(overtime.hourlyRate, locale)}</Row>
            <Row label={t.entryDetails.amount}>
              <span className="font-semibold text-success">+{formatEGP(overtime.amount, locale)}</span>
            </Row>
            {overtime.originalHours != null && overtime.originalHours !== overtime.hours && (
              <Row label={t.entryDetails.originalHours}>{overtime.originalHours}</Row>
            )}
            {overtime.originalAmount != null && overtime.originalAmount !== overtime.amount && (
              <Row label={t.entryDetails.originalAmount}>{formatEGP(overtime.originalAmount, locale)}</Row>
            )}
            <Row label={t.entryDetails.date}>{overtime.date}</Row>
            <Row label={t.entryDetails.status}>{requestStatusLabel(overtime.status, t)}</Row>
            {overtime.approvedBy && <Row label={t.entryDetails.approvedBy}>{overtime.approvedBy}</Row>}
            {overtime.notes && <Row label={t.entryDetails.notes}>{overtime.notes}</Row>}
          </Section>
          {employee}
          {day}
          <SourceRows auto={Boolean(overtime.autoGenerated)} editedBy={overtime.editedBy} createdAt={overtime.createdAt} stampFmt={stampFmt} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
