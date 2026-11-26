"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { createMission, updateMission } from "@/lib/actions/missions";
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
import { Employee, Mission } from "@/lib/types";
import { today } from "@/lib/today";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.missions.submit}</Button>;
}

function MissionFields({ mission, employeeId, setEmployeeId, employees }: {
  mission?: Mission;
  employeeId: string;
  setEmployeeId: (v: string) => void;
  employees: Employee[];
}) {
  const t = useT();
  const [mode, setMode] = useState<"range" | "timed">(mission?.startTime ? "timed" : "range");
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label>{t.missions.employee}</Label>
        <Select name="employeeId" value={employeeId} onValueChange={setEmployeeId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} — {e.employeeNumber}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="destination">{t.missions.destination}</Label>
        <Input id="destination" name="destination" defaultValue={mission?.destination} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t.missions.mode}</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as "range" | "timed")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="range">{t.missions.modeRange}</SelectItem>
            <SelectItem value="timed">{t.missions.modeTimed}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {mode === "range" ? (
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="from">{t.missions.from}</Label>
            <Input id="from" name="from" type="date" defaultValue={mission?.from ?? today()} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="to">{t.missions.to}</Label>
            <Input id="to" name="to" type="date" defaultValue={mission?.to ?? today()} required />
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="from">{t.missions.date}</Label>
            <Input id="from" name="from" type="date" defaultValue={mission?.from ?? today()} required />
            <input type="hidden" name="to" value={mission?.from ?? today()} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="startTime">{t.missions.startTime}</Label>
              <Input id="startTime" name="startTime" type="time" defaultValue={mission?.startTime} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="endTime">{t.missions.endTime}</Label>
              <Input id="endTime" name="endTime" type="time" defaultValue={mission?.endTime} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirmedEnd">{t.missions.confirmedEnd}</Label>
              <Input id="confirmedEnd" name="confirmedEnd" type="time" defaultValue={mission?.confirmedEnd} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="durationMinutes">{t.missions.durationMinutes}</Label>
              <Input id="durationMinutes" name="durationMinutes" type="number" min={1} defaultValue={mission?.durationMinutes} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t.missions.confirmedEndHint}</p>
        </>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reason">{t.missions.reason}</Label>
        <Textarea id="reason" name="reason" defaultValue={mission?.reason} />
      </div>
    </>
  );
}

export function MissionFormDialog({ employees }: { employees: Employee[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [state, formAction] = useActionState(createMission, {});
  useActionFeedback(state, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2"><Plus className="h-4 w-4" />{t.missions.addMission}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t.missions.dialogTitle}</DialogTitle></DialogHeader>
        <form action={formAction} ref={keepFilledFields} className="flex flex-col gap-4">
          <MissionFields employeeId={employeeId} setEmployeeId={setEmployeeId} employees={employees} />
          <DialogFooter><SubmitButton /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditMissionDialog({ mission, employees, open, onOpenChange }: {
  mission: Mission;
  employees: Employee[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [employeeId, setEmployeeId] = useState(mission.employeeId);
  const [state, formAction] = useActionState(updateMission, {});
  useActionFeedback(state, () => onOpenChange(false));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t.missions.editTitle}</DialogTitle></DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={mission.id} />
          <MissionFields mission={mission} employeeId={employeeId} setEmployeeId={setEmployeeId} employees={employees} />
          <DialogFooter><SubmitButton /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
