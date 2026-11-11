"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { createOvertime } from "@/lib/actions/overtime";
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
import { Employee } from "@/lib/types";
import { today } from "@/lib/today";
import { useAssistantDraft } from "@/components/assistant/draft-provider";
import { AssistantDraftNotice } from "@/components/assistant/draft-notice";
import { typeIntoField } from "@/lib/assistant/type-into";
import type { DraftValues } from "@/lib/assistant/drafts";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.overtime.submit}</Button>;
}

export function OvertimeFormDialog({ employees, defaultRates }: { employees: Employee[]; defaultRates: Record<string, number> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id);
  const employee = employees.find((e) => e.id === employeeId);
  // an overtime hour: the hourly wage × the overtime multiplier of the employee's pay type (from settings)
  const defaultRate = employee ? defaultRates[employee.id] ?? 0 : 0;
  const [state, formAction] = useActionState(createOvertime, {});
  useActionFeedback(state, () => {
    setOpen(false);
    setSeed(null);
  });

  // a form the assistant filled in: open the dialog with it, typing the notes in; the admin still presses submit
  const { values: draft, clear } = useAssistantDraft("overtime");
  const [seed, setSeed] = useState<DraftValues | null>(null);
  useEffect(() => {
    if (!draft) return;
    if (typeof draft.employeeId === "string" && employees.some((e) => e.id === draft.employeeId)) setEmployeeId(draft.employeeId);
    setSeed(draft);
    setOpen(true);
    clear();
    if (typeof draft.notes === "string") typeIntoField("notes", draft.notes);
  }, [draft, clear, employees]);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSeed(null); }}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" />{t.overtime.addOvertime}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t.overtime.dialogTitle}</DialogTitle></DialogHeader>
        {seed && <AssistantDraftNotice />}
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
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="date">{t.overtime.formDate}</Label>
              <Input id="date" name="date" type="date" defaultValue={typeof seed?.date === "string" ? seed.date : today()} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hours">{t.overtime.formHours}</Label>
              <Input id="hours" name="hours" type="number" step="0.5" min={0.5} defaultValue={typeof seed?.hours === "number" ? seed.hours : 2} required />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hourlyRate">{t.overtime.formRate}</Label>
            <Input id="hourlyRate" name="hourlyRate" type="number" min={0} key={employeeId} defaultValue={typeof seed?.hourlyRate === "number" && seed.employeeId === employeeId ? seed.hourlyRate : defaultRate} required />
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
