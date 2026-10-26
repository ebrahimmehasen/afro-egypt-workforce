"use client";

import { deductionTypeLabel } from "@/lib/i18n/labels";
import { useFormStatus } from "react-dom";
import { useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { createDeduction } from "@/lib/actions/deductions";
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
import { DeductionType, Employee } from "@/lib/types";
import { today } from "@/lib/today";
import { useAssistantDraft } from "@/components/assistant/draft-provider";
import { AssistantDraftNotice } from "@/components/assistant/draft-notice";
import { typeIntoField } from "@/lib/assistant/type-into";
import type { DraftValues } from "@/lib/assistant/drafts";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.deductions.submitDeduction}</Button>;
}

const DEDUCTION_TYPES: DeductionType[] = ["late", "absence", "early_leave", "permission", "unauthorized_exit", "penalty", "advance", "admin_deduction", "other"];

export function DeductionFormDialog({ employees }: { employees: Employee[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createDeduction, {});
  useActionFeedback(state, () => {
    setOpen(false);
    setSeed(null);
  });

  // a form the assistant filled in: open the dialog with it, typing the reason and notes in; the admin still presses submit
  const { values: draft, clear } = useAssistantDraft("deduction");
  const [seed, setSeed] = useState<DraftValues | null>(null);
  useEffect(() => {
    if (!draft) return;
    setSeed(draft);
    setOpen(true);
    clear();
    if (typeof draft.reason === "string") typeIntoField("reason", draft.reason);
    if (typeof draft.notes === "string") typeIntoField("notes", draft.notes);
  }, [draft, clear]);
  const pickedEmployee = typeof seed?.employeeId === "string" && employees.some((e) => e.id === seed.employeeId) ? seed.employeeId : employees[0]?.id;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSeed(null); }}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" />{t.deductions.addDeduction}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t.deductions.dialogDeductionTitle}</DialogTitle></DialogHeader>
        {seed && <AssistantDraftNotice />}
        <form key={seed ? "draft" : "plain"} action={formAction} ref={keepFilledFields} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{t.common.employee}</Label>
            <Select name="employeeId" defaultValue={pickedEmployee}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} — {e.employeeNumber}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t.deductions.formType}</Label>
            <Select name="type" defaultValue={typeof seed?.type === "string" ? seed.type : "penalty"}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEDUCTION_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>{deductionTypeLabel(value, t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="amount">{t.deductions.formAmount}</Label>
              <Input id="amount" name="amount" type="number" min={1} defaultValue={typeof seed?.amount === "number" ? seed.amount : undefined} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="date">{t.deductions.formDate}</Label>
              <Input id="date" name="date" type="date" defaultValue={typeof seed?.date === "string" ? seed.date : today()} required />
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
