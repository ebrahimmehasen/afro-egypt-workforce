"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { Fingerprint } from "lucide-react";
import { addReviewedPunches } from "@/lib/actions/review-punches";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

function Submit() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.reviewPunch.submit}</Button>;
}

/**
 * Enter the exit and/or return times HR actually knows for a day with a forgotten punch. The only way out of the form
 * is to enter real times with their source (or close it): there is no estimate, skip or "no charge" option.
 */
export function ReviewPunchDialog({ employeeId, date, employeeName }: { employeeId: string; date: string; employeeName: string }) {
  const t = useT();
  const p = t.reviewPunch;
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(addReviewedPunches, {});
  useActionFeedback(state, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="mt-1 w-fit gap-1.5">
          <Fingerprint className="h-3.5 w-3.5" />
          {p.button}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{p.title} — {employeeName}</DialogTitle></DialogHeader>
        <p data-testid="review-punch-intro" className="rounded-lg border-2 border-warning/60 bg-warning/10 px-3 py-2 text-sm font-medium text-foreground">{p.intro}</p>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="employeeId" value={employeeId} />
          <input type="hidden" name="date" value={date} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="review-out">{p.outLabel}</Label>
              <Input id="review-out" name="outTime" type="time" dir="ltr" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="review-back">{p.backLabel}</Label>
              <Input id="review-back" name="backTime" type="time" dir="ltr" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="review-reason">{p.reasonLabel}</Label>
            <Textarea id="review-reason" name="reason" required minLength={3} placeholder={p.reasonHint} />
          </div>
          <DialogFooter><Submit /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
