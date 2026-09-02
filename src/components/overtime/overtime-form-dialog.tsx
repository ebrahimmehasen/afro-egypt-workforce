"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { createOvertime } from "@/lib/actions/overtime";
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
import { Employee } from "@/lib/types";
import { DEMO_DATE } from "@/lib/constants";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.overtime.submit}</Button>;
}

export function OvertimeFormDialog({ employees }: { employees: Employee[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id);
  const employee = employees.find((e) => e.id === employeeId);
  const defaultRate = employee ? Math.round((employee.basicSalary / 26 / 8) * 1.5) : 0;
  const [state, formAction] = useActionState(createOvertime, {});
  useActionFeedback(state, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" />{t.overtime.addOvertime}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t.overtime.dialogTitle}</DialogTitle></DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{t.common.employee}</Label>
            <Select name="employeeId" value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} — {e.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="date">{t.overtime.formDate}</Label>
              <Input id="date" name="date" type="date" defaultValue={DEMO_DATE} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hours">{t.overtime.formHours}</Label>
              <Input id="hours" name="hours" type="number" step="0.5" min={0.5} defaultValue={2} required />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hourlyRate">{t.overtime.formRate}</Label>
            <Input id="hourlyRate" name="hourlyRate" type="number" min={0} key={employeeId} defaultValue={defaultRate} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">{t.overtime.formNotes}</Label>
            <Textarea id="notes" name="notes" />
          </div>
          <DialogFooter><SubmitButton /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
