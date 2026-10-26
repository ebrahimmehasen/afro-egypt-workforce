"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useEffect, useState } from "react";
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
import { useAssistantDraft } from "@/components/assistant/draft-provider";
import { AssistantDraftNotice } from "@/components/assistant/draft-notice";
import { typeIntoField } from "@/lib/assistant/type-into";
import type { DraftValues } from "@/lib/assistant/drafts";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.leaves.submitRequest}</Button>;
}

const LEAVE_TYPES: LeaveType[] = ["annual", "casual", "sick", "unpaid", "mission", "permission", "excused_absence"];

export function LeaveFormDialog({
  employees,
  balances = {},
}: {
  employees: Employee[];
  /** employee id → annual-leave balance, for the employees this viewer can see */
  balances?: Record<string, LeaveBalance>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [type, setType] = useState<LeaveType>("annual");
  const [state, formAction] = useActionState(createLeave, {});
  useActionFeedback(state, () => {
    setOpen(false);
    setSeed(null);
  });

  // a form the assistant filled in: open the dialog with it, typing the reason in; the admin still presses submit
  const { values: draft, clear } = useAssistantDraft("leave");
  const [seed, setSeed] = useState<DraftValues | null>(null);
  useEffect(() => {
    if (!draft) return;
    if (typeof draft.employeeId === "string" && employees.some((e) => e.id === draft.employeeId)) setEmployeeId(draft.employeeId);
    if (typeof draft.type === "string" && LEAVE_TYPES.includes(draft.type as LeaveType)) setType(draft.type as LeaveType);
    setSeed(draft);
    setOpen(true);
    clear();
    if (typeof draft.reason === "string") typeIntoField("reason", draft.reason);
  }, [draft, clear, employees]);

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
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSeed(null); }}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" />{t.leaves.requestNew}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t.leaves.dialogTitle}</DialogTitle></DialogHeader>
        {seed && <AssistantDraftNotice />}
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
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="from">{t.leaves.formFrom}</Label>
              <Input id="from" name="from" type="date" defaultValue={typeof seed?.from === "string" ? seed.from : today()} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="to">{t.leaves.formTo}</Label>
              <Input id="to" name="to" type="date" defaultValue={typeof seed?.to === "string" ? seed.to : today()} required />
            </div>
          </div>
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
