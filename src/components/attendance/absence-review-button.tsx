"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2 } from "lucide-react";
import { markAbsenceReviewed } from "@/lib/actions/absence-review";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

function Submit() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" size="sm" disabled={pending}>{pending ? t.common.saving : t.absenceReview.button}</Button>;
}

/** Marks an absent day reviewed — nothing else changes. Disappears from the bell and this list once saved. */
export function AbsenceReviewButton({ employeeId, date }: { employeeId: string; date: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(markAbsenceReviewed, {});
  useActionFeedback(state, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="mt-1 w-fit gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {t.absenceReview.button}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t.absenceReview.button}</DialogTitle></DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="employeeId" value={employeeId} />
          <input type="hidden" name="date" value={date} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="absence-review-note">{t.absenceReview.note}</Label>
            <Textarea id="absence-review-note" name="note" placeholder={t.absenceReview.noteHint} />
          </div>
          <DialogFooter><Submit /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
