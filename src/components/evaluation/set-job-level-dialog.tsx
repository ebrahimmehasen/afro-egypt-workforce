"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil } from "lucide-react";
import { setEmployeeJobLevel } from "@/lib/actions/evaluation";
import { keepFilledFields, useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

function Submit() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.evaluation.setLevel.submit}</Button>;
}

/** Admin-only: records a new job level for an employee as a history row — the previous ones are never overwritten. */
export function SetJobLevelDialog({ employeeId, levels }: { employeeId: string; levels: { id: string; name: string }[] }) {
  const t = useT();
  const s = t.evaluation.setLevel;
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(setEmployeeJobLevel, {});
  useActionFeedback(state, () => setOpen(false));

  if (levels.length === 0) {
    return <p className="text-sm text-muted-foreground">{s.noLevelsYet}</p>;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5"><Pencil className="h-3.5 w-3.5" />{s.button}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{s.title}</DialogTitle></DialogHeader>
        <form action={formAction} ref={keepFilledFields} className="flex flex-col gap-4">
          <input type="hidden" name="employeeId" value={employeeId} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="level-select">{s.levelLabel}</Label>
            <Select name="jobLevelId">
              <SelectTrigger id="level-select" aria-invalid={state.fields?.includes("jobLevelId")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {levels.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="level-reason">{s.reasonLabel}</Label>
            <Textarea id="level-reason" name="reason" required minLength={1} maxLength={2000} placeholder={s.reasonHint} aria-invalid={state.fields?.includes("reason")} />
          </div>
          <DialogFooter><Submit /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
