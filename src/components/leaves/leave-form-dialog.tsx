"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { createLeave } from "@/lib/actions/leaves";
import { useActionFeedback, keepFilledFields } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Employee, LeaveType } from "@/lib/types";
import type { LeaveBalance } from "@/lib/leave-balance";
import { LeaveBalanceCard } from "@/components/leaves/leave-balance-card";
import { today } from "@/lib/today";
import { format } from "@/lib/i18n/format";
import { PayTypeRules, ScheduleTimes, at, dayTimes, isTime } from "@/lib/pay-engine";
import { permissionKind } from "@/lib/mid-day-exits";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.leaves.submitRequest}</Button>;
}

const LEAVE_TYPES: LeaveType[] = ["annual", "casual", "sick", "unpaid", "mission", "permission", "excused_absence"];

/** An employee's working times and Thursday rule, for telling a temporary permission from leaving early. */
export type PermissionDayRules = { schedule: ScheduleTimes; rules: Pick<PayTypeRules, "thursdayRuleEnabled" | "thursdayWorkEnd"> };

const clock = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export function LeaveFormDialog({
  employees,
  balances = {},
  dayRules = {},
}: {
  employees: Employee[];
  /** employee id → annual-leave balance, for the employees this viewer can see */
  balances?: Record<string, LeaveBalance>;
  /** employee id → their working times, for showing how a permission will be treated */
  dayRules?: Record<string, PermissionDayRules>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [type, setType] = useState<LeaveType>("annual");
  const [date, setDate] = useState(today());
  const [startTime, setStartTime] = useState("");
  const [duration, setDuration] = useState("");
  const isPermission = type === "permission";

  // The same rule the server and the pay engine apply: ending before the day does, it is temporary; else leaving early.
  const kindLine = (() => {
    const r = dayRules[employeeId];
    const minutes = Number(duration);
    if (!r || !isTime(startTime) || !(minutes > 0)) return t.leaves.kindUnknown;
    const start = at(date, startTime, r.schedule.start);
    const end = dayTimes(date, r.schedule, r.rules as PayTypeRules).end;
    return permissionKind(start, minutes, end) === "early_leave"
      ? t.leaves.kindEarlyLeave
      : format(t.leaves.kindTemporary, { back: clock(new Date(start.getTime() + minutes * 60_000)) });
  })();
  const [state, formAction] = useActionState(createLeave, {});
  useActionFeedback(state, () => setOpen(false));

  const leaveTypeLabels: Record<LeaveType, string> = {
    annual: t.leaveTypes.annual,
    casual: t.leaveTypes.casual,
    sick: t.leaveTypes.sick,
    unpaid: t.leaveTypes.unpaid,
    mission: t.leaveTypes.mission,
    permission: t.leaveTypes.permission,
    excused_absence: t.leaveTypes.excusedAbsence,
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" />{t.leaves.requestNew}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t.leaves.dialogTitle}</DialogTitle></DialogHeader>
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{t.leaves.noticeHint}</p>
        <form action={formAction} ref={keepFilledFields} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{t.common.employee}</Label>
            <Select name="employeeId" value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} — {e.employeeNumber}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t.leaves.formType}</Label>
            <Select name="type" value={type} onValueChange={(v) => setType(v as LeaveType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEAVE_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>{leaveTypeLabels[value]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {type === "annual" && balances[employeeId] && <LeaveBalanceCard balance={balances[employeeId]} />}
          {isPermission ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="from">{t.leaves.formDate}</Label>
                  <Input id="from" name="from" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                  {/* a permission is for one day */}
                  <input type="hidden" name="to" value={date} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="startTime">{t.leaves.formStartTime}</Label>
                  <Input id="startTime" name="startTime" type="time" dir="ltr" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="durationMinutes">{t.leaves.formDuration}</Label>
                  <Input id="durationMinutes" name="durationMinutes" type="number" min={1} step={1} dir="ltr" value={duration} onChange={(e) => setDuration(e.target.value)} required />
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
                <p className="font-medium text-foreground">{kindLine}</p>
                <p className="mt-1 text-muted-foreground">{t.leaves.kindHint}</p>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="from">{t.leaves.formFrom}</Label>
                <Input id="from" name="from" type="date" defaultValue={today()} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="to">{t.leaves.formTo}</Label>
                <Input id="to" name="to" type="date" defaultValue={today()} required />
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reason">{t.leaves.formReason} <span className="text-xs font-normal text-muted-foreground">({t.common.optional})</span></Label>
            <Textarea id="reason" name="reason" />
          </div>
          <DialogFooter><SubmitButton /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
