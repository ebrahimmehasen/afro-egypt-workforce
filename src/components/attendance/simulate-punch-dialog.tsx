"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { Fingerprint } from "lucide-react";
import { simulatePunch } from "@/lib/actions/attendance";
import { useActionFeedback } from "@/hooks/use-action-feedback";
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
import { today } from "@/lib/demo-mode";
import { DEVICE_ID } from "@/lib/constants";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <Button type="submit" size="lg" disabled={pending} className="gap-2">
      <Fingerprint className="h-4 w-4" />
      {pending ? t.attendance.submitting : t.attendance.submitPunch}
    </Button>
  );
}

export function SimulatePunchDialog({ employees }: { employees: Employee[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(simulatePunch, {});
  useActionFeedback(state, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="gap-2">
          <Fingerprint className="h-4 w-4" />
          {t.attendance.simulatePunch}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Fingerprint className="h-5 w-5 text-primary" />
            {t.attendance.simulatePunch}
          </DialogTitle>
          <DialogDescription>{t.attendance.simulateDialogDesc}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{t.attendance.selectEmployee}</Label>
            <Select name="employeeId" defaultValue={employees[0]?.id}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name} — {e.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t.attendance.punchType}</Label>
            <Select name="punchType" defaultValue="in">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="in">{t.attendance.punchIn}</SelectItem>
                <SelectItem value="out">{t.attendance.punchOut}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="date">{t.common.date}</Label>
              <Input id="date" name="date" type="date" defaultValue={today()} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="time">{t.common.time}</Label>
              <Input id="time" name="time" type="time" defaultValue={new Date().toISOString().slice(11, 16)} required />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="deviceId">{t.attendance.device}</Label>
            <Input id="deviceId" name="deviceId" defaultValue={DEVICE_ID} dir="ltr" readOnly className="bg-muted" />
          </div>

          <DialogFooter>
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
