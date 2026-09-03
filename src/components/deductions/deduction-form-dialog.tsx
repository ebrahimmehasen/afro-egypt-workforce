"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { createDeduction } from "@/lib/actions/deductions";
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
import { DeductionType, Employee } from "@/lib/types";
import { today } from "@/lib/today";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.deductions.submitDeduction}</Button>;
}

const DEDUCTION_TYPES: DeductionType[] = ["late", "absence", "early_leave", "penalty", "advance", "admin_deduction", "other"];

export function DeductionFormDialog({ employees }: { employees: Employee[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createDeduction, {});
  useActionFeedback(state, () => setOpen(false));

  const typeLabels: Record<DeductionType, string> = {
    late: t.deductionTypes.late,
    absence: t.deductionTypes.absence,
    early_leave: t.deductionTypes.earlyLeave,
    penalty: t.deductionTypes.penalty,
    advance: t.deductionTypes.advance,
    admin_deduction: t.deductionTypes.adminDeduction,
    other: t.deductionTypes.other,
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" />{t.deductions.addDeduction}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t.deductions.dialogDeductionTitle}</DialogTitle></DialogHeader>
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
            <Label>{t.deductions.formType}</Label>
            <Select name="type" defaultValue="penalty">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEDUCTION_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>{typeLabels[value]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="amount">{t.deductions.formAmount}</Label>
              <Input id="amount" name="amount" type="number" min={1} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="date">{t.deductions.formDate}</Label>
              <Input id="date" name="date" type="date" defaultValue={today()} required />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reason">{t.deductions.formReason}</Label>
            <Input id="reason" name="reason" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">{t.common.optionalNotes}</Label>
            <Textarea id="notes" name="notes" />
          </div>
          <DialogFooter><SubmitButton /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
