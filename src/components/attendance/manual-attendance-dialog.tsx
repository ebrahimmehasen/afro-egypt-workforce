"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { addManualAttendance } from "@/lib/actions/attendance";
import { useActionFeedback, keepFilledFields } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Employee } from "@/lib/types";
import { today } from "@/lib/today";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.attendance.manualSubmit}</Button>;
}

/** Records a full in/out punch for one employee/day by hand — goes through the exact same
 * recalculation as a fingerprint punch (see applyAddManualAttendance). */
export function ManualAttendanceDialog({ employees }: { employees: Employee[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(addManualAttendance, {});
  useActionFeedback(state, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2"><Plus className="h-4 w-4" />{t.attendance.addManualAttendance}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.attendance.manualAttendanceTitle}</DialogTitle>
          <DialogDescription>{t.attendance.manualAttendanceDesc}</DialogDescription>
        </DialogHeader>
        <form action={formAction} ref={keepFilledFields} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{t.attendance.manualFormEmployee}</Label>
            <Select name="employeeId" defaultValue={employees[0]?.id}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} — {e.employeeNumber}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="manual-date">{t.attendance.manualFormDate}</Label>
            <Input id="manual-date" name="date" type="date" defaultValue={today()} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual-start">{t.attendance.manualFormStart}</Label>
              <Input id="manual-start" name="workStart" type="time" defaultValue="08:00" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual-end">{t.attendance.manualFormEnd}</Label>
              <Input id="manual-end" name="workEnd" type="time" defaultValue="16:30" required />
            </div>
          </div>
          <DialogFooter><SubmitButton /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
