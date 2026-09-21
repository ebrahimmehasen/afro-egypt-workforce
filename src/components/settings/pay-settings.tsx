"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { CalendarClock, Clock, Pencil, Plus, Scale, Settings2, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  deletePayType,
  deleteWorkSchedule,
  saveGeneralPaySettings,
  savePayType,
  saveWorkSchedule,
  updatePayTypeRule,
} from "@/lib/actions/pay-settings";
import { keepFilledFields, useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { format } from "@/lib/i18n/format";
import { PayTypeRules } from "@/lib/pay-engine";
import { FALLBACK_PAY_TYPES } from "@/lib/pay-defaults";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type PayTypeRow = PayTypeRules & { active: boolean; deletedAt: string | null; employees: number };
export interface ScheduleRow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  overtimeStart: string | null;
  active: boolean;
  deletedAt: string | null;
  employees: number;
}

function SubmitButton({ label }: { label?: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : label ?? t.common.save}</Button>;
}

function DeleteButton({ title, confirm, run }: { title: string; confirm: string; run: () => Promise<{ error?: string; message?: string }> }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" aria-label={t.common.delete} disabled={pending}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              startTransition(async () => {
                const res = await run();
                if (res.error) toast.error(res.error);
                else toast.success(res.message ?? t.paySettings.deleted);
              })
            }
          >
            {t.common.delete}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Pay types

function PayTypeDialog({ payType }: { payType?: PayTypeRow }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(savePayType, {});
  useActionFeedback(state, () => setOpen(false));
  const [thursday, setThursday] = useState(payType?.thursdayRuleEnabled ?? false);
  const bad = (f: string) => (state.fields?.includes(f) ? "border-destructive ring-1 ring-destructive" : "");
  const r = t.paySettings.rules;
  // a new pay type starts from the built-in salaried one's values (the same single set of defaults)
  const d = payType ?? FALLBACK_PAY_TYPES.monthly;
  const num = (name: keyof PayTypeRules, label: string, value: number | null | undefined, step = "0.01") => (
    <Field label={label}>
      <Input name={name} type="number" min={0} step={step} defaultValue={value ?? ""} className={bad(name)} required />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {payType ? (
          <Button size="icon" variant="ghost" aria-label={t.paySettings.editPayType}><Pencil className="h-4 w-4" /></Button>
        ) : (
          <Button className="gap-2"><Plus className="h-4 w-4" />{t.paySettings.addPayType}</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{payType ? t.paySettings.editPayType : t.paySettings.addPayType}</DialogTitle>
          <DialogDescription>{t.paySettings.recalcNote}</DialogDescription>
        </DialogHeader>
        <form action={formAction} ref={keepFilledFields} className="flex flex-col gap-5">
          {payType && <input type="hidden" name="id" value={payType.id} />}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t.paySettings.fieldName}>
              <Input name="name" defaultValue={payType?.name} className={bad("name")} required minLength={2} />
            </Field>
            <Field label={t.paySettings.fieldBasis}>
              <Select name="basis" defaultValue={d.basis}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">{t.paySettings.basisMonthly}</SelectItem>
                  <SelectItem value="daily">{t.paySettings.basisDaily}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {num("dayDivisor", `${r.dayDivisor.label} (${t.paySettings.unitDivisor})`, d.dayDivisor)}
            <Field label={t.paySettings.fieldHoursPerDay} hint={t.paySettings.hoursPerDayHint}>
              <Input name="hoursPerDay" type="number" min={0} step="0.25" defaultValue={payType?.hoursPerDay ?? ""} className={bad("hoursPerDay")} />
            </Field>
          </div>

          <section className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-muted-foreground">{t.paySettings.sectionTimes}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label={t.paySettings.fieldWorkStart}><Input name="workStart" type="time" defaultValue={payType?.workStart ?? ""} className={bad("workStart")} /></Field>
              <Field label={t.paySettings.fieldWorkEnd}><Input name="workEnd" type="time" defaultValue={payType?.workEnd ?? ""} className={bad("workEnd")} /></Field>
              <Field label={t.paySettings.fieldOvertimeStart} hint={t.paySettings.overtimeStartHint}>
                <Input name="overtimeStart" type="time" defaultValue={payType?.overtimeStart ?? ""} className={bad("overtimeStart")} />
              </Field>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-muted-foreground">{t.paySettings.sectionRules}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {num("overtimeMultiplier", r.overtimeMultiplier.label, d.overtimeMultiplier)}
              {num("overtimeMinimumMinutes", `${r.overtimeMinimumMinutes.label} (${t.paySettings.unitMinutes})`, d.overtimeMinimumMinutes, "1")}
              {num("overtimeStepMinutes", `${r.overtimeStepMinutes.label} (${t.paySettings.unitMinutes})`, d.overtimeStepMinutes, "1")}
              {num("lateMultiplier", r.lateMultiplier.label, d.lateMultiplier)}
              {num("graceMinutes", `${r.graceMinutes.label} (${t.paySettings.unitMinutes})`, d.graceMinutes)}
              {num("permissionMultiplier", r.permissionMultiplier.label, d.permissionMultiplier)}
              {num("unauthorizedExitMultiplier", r.unauthorizedExitMultiplier.label, d.unauthorizedExitMultiplier)}
              {num("fridayMultiplier", r.fridayMultiplier.label, d.fridayMultiplier)}
              {num("holidayMultiplier", r.holidayMultiplier.label, d.holidayMultiplier)}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch name="overtimeAutoApprove" defaultChecked={d.overtimeAutoApprove} />
              {t.paySettings.fieldAutoApprove}
            </label>
          </section>

          <section className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-muted-foreground">{t.paySettings.sectionThursday}</p>
            <label className="flex items-center gap-2 text-sm">
              <Switch name="thursdayRuleEnabled" checked={thursday} onCheckedChange={setThursday} />
              {t.paySettings.fieldThursdayEnabled}
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t.paySettings.fieldThursdayEnd}>
                <Input name="thursdayWorkEnd" type="time" defaultValue={payType?.thursdayWorkEnd ?? ""} disabled={!thursday} className={bad("thursdayWorkEnd")} />
              </Field>
              {num("thursdayExtraMultiplier", r.thursdayExtraMultiplier.label, d.thursdayExtraMultiplier)}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-muted-foreground">{t.paySettings.sectionAbsence}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {num("permittedAbsenceDays", `${r.permittedAbsenceDays.label} (${t.paySettings.unitDays})`, d.permittedAbsenceDays)}
              {num("unpermittedAbsenceDays", `${r.unpermittedAbsenceDays.label} (${t.paySettings.unitDays})`, d.unpermittedAbsenceDays)}
              {num("leaveNoticeHours", `${r.leaveNoticeHours.label} (${t.paySettings.unitHours})`, d.leaveNoticeHours, "1")}
            </div>
          </section>

          <label className="flex items-center gap-2 text-sm">
            <Switch name="active" defaultChecked={payType?.active ?? true} />
            {t.paySettings.fieldActive}
          </label>
          <DialogFooter><SubmitButton /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PayTypesSection({ payTypes, canManage }: { payTypes: PayTypeRow[]; canManage: boolean }) {
  const t = useT();
  const shown = payTypes.filter((p) => !p.deletedAt);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5 text-primary" />{t.paySettings.payTypesTitle}</CardTitle>
          <CardDescription>{t.paySettings.payTypesDesc}</CardDescription>
        </div>
        {canManage && <PayTypeDialog />}
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {shown.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                  {p.name}
                  {p.code && <Badge variant="secondary">{t.paySettings.builtIn}</Badge>}
                  {!p.active && <Badge variant="outline">{t.paySettings.inactive}</Badge>}
                  <Badge variant="outline">{format(t.paySettings.employeesOn, { count: p.employees })}</Badge>
                </p>
                <p className="text-sm text-muted-foreground">
                  {p.basis === "daily" ? t.paySettings.basisDaily : t.paySettings.basisMonthly} · {t.paySettings.rules.dayDivisor.label} ÷ {p.dayDivisor}
                  {p.workStart && p.workEnd && <> · <span dir="ltr">{p.workStart} → {p.workEnd}</span></>}
                </p>
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center gap-1">
                  <PayTypeDialog payType={p} />
                  {!p.code && (
                    <DeleteButton
                      title={t.paySettings.deletePayTypeTitle}
                      confirm={format(t.paySettings.deletePayTypeConfirm, { name: p.name })}
                      run={() => deletePayType(p.id)}
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Work schedules

function ScheduleDialog({ schedule }: { schedule?: ScheduleRow }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(saveWorkSchedule, {});
  useActionFeedback(state, () => setOpen(false));
  const bad = (f: string) => (state.fields?.includes(f) ? "border-destructive ring-1 ring-destructive" : "");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {schedule ? (
          <Button size="icon" variant="ghost" aria-label={t.paySettings.editSchedule}><Pencil className="h-4 w-4" /></Button>
        ) : (
          <Button className="gap-2"><Plus className="h-4 w-4" />{t.paySettings.addSchedule}</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{schedule ? t.paySettings.editSchedule : t.paySettings.addSchedule}</DialogTitle>
          <DialogDescription>{t.paySettings.recalcNote}</DialogDescription>
        </DialogHeader>
        <form action={formAction} ref={keepFilledFields} className="flex flex-col gap-4">
          {schedule && <input type="hidden" name="id" value={schedule.id} />}
          <Field label={t.paySettings.scheduleName} hint={t.paySettings.scheduleNameHint}>
            <Input name="name" defaultValue={schedule?.name ?? ""} className={bad("name")} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={t.paySettings.scheduleStart}><Input name="startTime" type="time" defaultValue={schedule?.startTime ?? "08:00"} className={bad("startTime")} required /></Field>
            <Field label={t.paySettings.scheduleEnd}><Input name="endTime" type="time" defaultValue={schedule?.endTime ?? ""} className={bad("endTime")} required /></Field>
            <Field label={t.paySettings.scheduleOvertimeStart} hint={t.paySettings.overtimeStartHint}>
              <Input name="overtimeStart" type="time" defaultValue={schedule?.overtimeStart ?? ""} className={bad("overtimeStart")} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch name="active" defaultChecked={schedule?.active ?? true} />
            {t.paySettings.scheduleActive}
          </label>
          <DialogFooter><SubmitButton /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WorkSchedulesSection({ schedules, canManage }: { schedules: ScheduleRow[]; canManage: boolean }) {
  const t = useT();
  const shown = schedules.filter((s) => !s.deletedAt);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-primary" />{t.paySettings.schedulesTitle}</CardTitle>
          <CardDescription>{t.paySettings.schedulesDesc}</CardDescription>
        </div>
        {canManage && <ScheduleDialog />}
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t.paySettings.noSchedules}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {shown.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                    <span dir="ltr">{s.name}</span>
                    {!s.active && <Badge variant="outline">{t.paySettings.inactive}</Badge>}
                    <Badge variant="outline">{format(t.paySettings.employeesOn, { count: s.employees })}</Badge>
                  </p>
                  <p className="text-sm text-muted-foreground" dir="ltr">
                    {s.startTime} → {s.endTime}
                    {s.overtimeStart && s.overtimeStart !== s.endTime && ` · OT ${s.overtimeStart}`}
                  </p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-1">
                    <ScheduleDialog schedule={s} />
                    <DeleteButton
                      title={t.paySettings.deleteScheduleTitle}
                      confirm={format(t.paySettings.deleteScheduleConfirm, { name: s.name })}
                      run={() => deleteWorkSchedule(s.id)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Payroll rules: every rule of every pay type, with its current value, unit, meaning, and an Edit

type RuleKey = keyof ReturnType<typeof useT>["paySettings"]["rules"];
const RULE_ROWS: { key: RuleKey; unit: "times" | "minutes" | "days" | "hours" | "divisor" }[] = [
  { key: "overtimeMultiplier", unit: "times" },
  { key: "overtimeMinimumMinutes", unit: "minutes" },
  { key: "overtimeStepMinutes", unit: "minutes" },
  { key: "lateMultiplier", unit: "times" },
  { key: "graceMinutes", unit: "minutes" },
  { key: "permissionMultiplier", unit: "times" },
  { key: "unauthorizedExitMultiplier", unit: "times" },
  { key: "fridayMultiplier", unit: "times" },
  { key: "holidayMultiplier", unit: "times" },
  { key: "thursdayExtraMultiplier", unit: "times" },
  { key: "dayDivisor", unit: "divisor" },
  { key: "permittedAbsenceDays", unit: "days" },
  { key: "unpermittedAbsenceDays", unit: "days" },
  { key: "leaveNoticeHours", unit: "hours" },
];

function RuleEditDialog({ payType, rule }: { payType: PayTypeRow; rule: RuleKey }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(updatePayTypeRule, {});
  useActionFeedback(state, () => setOpen(false));
  const text = t.paySettings.rules[rule];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1"><Pencil className="h-3.5 w-3.5" />{t.paySettings.editRule}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{text.label} — {payType.name}</DialogTitle>
          <DialogDescription>{text.desc}</DialogDescription>
        </DialogHeader>
        <form action={formAction} ref={keepFilledFields} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={payType.id} />
          <input type="hidden" name="field" value={rule} />
          <Input name="value" type="number" min={0} step="0.01" defaultValue={payType[rule] as number} required autoFocus />
          <p className="text-xs text-muted-foreground">{t.paySettings.recalcNote}</p>
          <DialogFooter><SubmitButton /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PayRulesSection({ payTypes, canManage }: { payTypes: PayTypeRow[]; canManage: boolean }) {
  const t = useT();
  const shown = payTypes.filter((p) => !p.deletedAt);
  const unit = { times: t.paySettings.unitTimes, minutes: t.paySettings.unitMinutes, days: t.paySettings.unitDays, hours: t.paySettings.unitHours, divisor: t.paySettings.unitDivisor };
  if (shown.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Scale className="h-5 w-5 text-primary" />{t.paySettings.rulesTitle}</CardTitle>
        <CardDescription>{t.paySettings.rulesDesc}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={shown[0].id}>
          <TabsList className="flex-wrap">
            {shown.map((p) => <TabsTrigger key={p.id} value={p.id}>{p.name}</TabsTrigger>)}
          </TabsList>
          {shown.map((p) => (
            <TabsContent key={p.id} value={p.id} className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">
                  {t.paySettings.sectionThursday}: {p.thursdayRuleEnabled ? format(t.paySettings.thursdayRuleOn, { time: p.thursdayWorkEnd ?? "—" }) : t.paySettings.thursdayRuleOff}
                </Badge>
                <Badge variant="outline">{p.overtimeAutoApprove ? t.paySettings.autoApproveOn : t.paySettings.autoApproveOff}</Badge>
              </div>
              <div className="overflow-hidden rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.paySettings.colRule}</TableHead>
                      <TableHead>{t.paySettings.colCurrent}</TableHead>
                      <TableHead>{t.paySettings.colUnit}</TableHead>
                      <TableHead>{t.paySettings.colDescription}</TableHead>
                      {canManage && <TableHead className="text-end" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {RULE_ROWS.map(({ key, unit: u }) => (
                      <TableRow key={key}>
                        <TableCell className="font-medium">{t.paySettings.rules[key].label}</TableCell>
                        <TableCell className="tabular-nums font-semibold">{String(p[key])}</TableCell>
                        <TableCell>{unit[u]}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{t.paySettings.rules[key].desc}</TableCell>
                        {canManage && <TableCell className="text-end"><RuleEditDialog payType={p} rule={key} /></TableCell>}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------
// General

export function GeneralPaySection({ weeklyOffDays, payPeriodStartDay, canManage }: { weeklyOffDays: number[]; payPeriodStartDay: number; canManage: boolean }) {
  const t = useT();
  const [state, formAction] = useActionState(saveGeneralPaySettings, {});
  useActionFeedback(state);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5 text-primary" />{t.paySettings.generalTitle}</CardTitle>
        <CardDescription>{t.paySettings.generalDesc}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-5">
          <fieldset disabled={!canManage} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label className="flex items-center gap-2"><CalendarClock className="h-4 w-4" />{t.paySettings.weeklyOffDays}</Label>
              <div className="flex flex-wrap gap-4">
                {t.paySettings.weekdays.map((name, day) => (
                  <label key={day} className="flex items-center gap-2 text-sm">
                    <Checkbox name="weeklyOffDays" value={String(day)} defaultChecked={weeklyOffDays.includes(day)} />
                    {name}
                  </label>
                ))}
              </div>
            </div>
            <div className="max-w-xs">
              <Field label={t.paySettings.payPeriodStartDay} hint={t.paySettings.payPeriodStartDayHint}>
                <Input name="payPeriodStartDay" type="number" min={1} max={28} defaultValue={payPeriodStartDay} required />
              </Field>
            </div>
          </fieldset>
          {canManage && <div><SubmitButton /></div>}
        </form>
      </CardContent>
    </Card>
  );
}
