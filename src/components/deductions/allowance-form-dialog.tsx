"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { createAllowance } from "@/lib/actions/allowances";
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
import { AllowanceType, Employee } from "@/lib/types";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.deductions.submitAllowance}</Button>;
}

const ALLOWANCE_TYPES: AllowanceType[] = ["transport", "meal", "fixed", "incentive", "bonus"];
const selectCls = "h-10 rounded-md border border-input bg-background px-3 text-sm";

export function AllowanceFormDialog({
  employees,
  currentPeriod,
}: {
  employees: Employee[];
  currentPeriod: { year: number; month: number };
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<AllowanceType>("incentive");
  const [state, formAction] = useActionState(createAllowance, {});
  useActionFeedback(state, () => setOpen(false));

  const typeLabels: Record<AllowanceType, string> = {
    transport: t.allowanceTypes.transport,
    meal: t.allowanceTypes.meal,
    fixed: t.allowanceTypes.fixed,
    incentive: t.allowanceTypes.incentive,
    bonus: t.allowanceTypes.bonus,
  };

  const years = [currentPeriod.year - 1, currentPeriod.year, currentPeriod.year + 1];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="gold" className="gap-2"><Plus className="h-4 w-4" />{t.deductions.addAllowance}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t.deductions.dialogAllowanceTitle}</DialogTitle></DialogHeader>
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
            <Select name="type" value={type} onValueChange={(v) => setType(v as AllowanceType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ALLOWANCE_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>{typeLabels[value]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {type === "bonus" ? (
              <p className="text-xs text-muted-foreground">{t.deductions.bonusHint}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t.deductions.recurringHint}</p>
            )}
          </div>

          {type === "bonus" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="alw-month">{t.deductions.bonusMonth}</Label>
                <select id="alw-month" name="effectiveMonth" defaultValue={String(currentPeriod.month)} className={selectCls}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="alw-year">{t.deductions.bonusYear}</Label>
                <select id="alw-year" name="effectiveYear" defaultValue={String(currentPeriod.year)} className={selectCls}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="amount">{t.deductions.formAmount}</Label>
            <Input id="amount" name="amount" type="number" min={1} required />
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
