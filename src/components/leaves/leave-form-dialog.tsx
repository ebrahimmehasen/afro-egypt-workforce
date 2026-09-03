"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { createLeave } from "@/lib/actions/leaves";
import { useActionFeedback } from "@/hooks/use-action-feedback";
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
import { today } from "@/lib/today";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.leaves.submitRequest}</Button>;
}

const LEAVE_TYPES: LeaveType[] = ["annual", "casual", "sick", "unpaid", "mission", "permission", "excused_absence"];

export function LeaveFormDialog({ employees }: { employees: Employee[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
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
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{t.common.employee}</Label>
            <Select name="employeeId" defaultValue={employees[0]?.id}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} — {e.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t.leaves.formType}</Label>
            <Select name="type" defaultValue="annual">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEAVE_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>{leaveTypeLabels[value]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reason">{t.leaves.formReason}</Label>
            <Textarea id="reason" name="reason" required />
          </div>
          <DialogFooter><SubmitButton /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
