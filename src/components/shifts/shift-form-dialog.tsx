"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { createShift, updateShift } from "@/lib/actions/shifts";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Shift } from "@/lib/types";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : label}</Button>;
}

export function ShiftFormDialog({ shift }: { shift?: Shift }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [allowOvertime, setAllowOvertime] = useState(shift?.allowOvertime ?? true);
  const action = shift ? updateShift : createShift;
  const [state, formAction] = useActionState(action, {});
  useActionFeedback(state, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {shift ? (
          <Button variant="ghost" size="icon" aria-label={t.common.edit}><Pencil className="h-4 w-4" /></Button>
        ) : (
          <Button className="gap-2"><Plus className="h-4 w-4" />{t.shifts.addShift}</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{shift ? t.shifts.editShift : t.shifts.addShift}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {shift && <input type="hidden" name="id" value={shift.id} />}
          <input type="hidden" name="workDays" value="0,1,2,3,4,5" />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">{t.shifts.formName}</Label>
            <Input id="name" name="name" defaultValue={shift?.name} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="startTime">{t.shifts.formStart}</Label>
              <Input id="startTime" name="startTime" type="time" defaultValue={shift?.startTime ?? "08:00"} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="endTime">{t.shifts.formEnd}</Label>
              <Input id="endTime" name="endTime" type="time" defaultValue={shift?.endTime ?? "16:00"} required />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gracePeriodMinutes">{t.shifts.formGrace}</Label>
            <Input id="gracePeriodMinutes" name="gracePeriodMinutes" type="number" min={0} defaultValue={shift?.gracePeriodMinutes ?? 10} required />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <Label htmlFor="allowOvertime" className="cursor-pointer">{t.shifts.formAllowOvertime}</Label>
            <Switch
              id="allowOvertime"
              name="allowOvertime"
              checked={allowOvertime}
              onCheckedChange={setAllowOvertime}
            />
          </div>
          <DialogFooter>
            <SubmitButton label={shift ? t.common.save : t.common.add} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
