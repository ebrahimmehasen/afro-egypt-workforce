"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { PencilLine } from "lucide-react";
import { correctAttendance } from "@/lib/actions/attendance";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { DailyAttendance } from "@/lib/types";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.attendance.saveCorrection}</Button>;
}

function timeValue(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(11, 16);
}

export function CorrectAttendanceDialog({ record, employeeName }: { record: DailyAttendance; employeeName: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(correctAttendance, {});
  useActionFeedback(state, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t.attendance.correctionAction}>
          <PencilLine className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.attendance.correctDialogTitle} {employeeName}</DialogTitle>
          <DialogDescription>{t.attendance.correctDialogDesc}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="employeeId" value={record.employeeId} />
          <input type="hidden" name="date" value={record.date} />
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="correctedIn">{t.attendance.correctedIn}</Label>
              <Input id="correctedIn" name="correctedIn" type="time" defaultValue={timeValue(record.actualIn)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="correctedOut">{t.attendance.correctedOut}</Label>
              <Input id="correctedOut" name="correctedOut" type="time" defaultValue={timeValue(record.actualOut)} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reason">{t.common.reason}</Label>
            <Textarea id="reason" name="reason" placeholder={t.attendance.correctionReasonPlaceholder} required />
          </div>
          <DialogFooter>
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
