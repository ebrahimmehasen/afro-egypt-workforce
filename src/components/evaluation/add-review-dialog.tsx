"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { addEvaluationReview } from "@/lib/actions/evaluation";
import { keepFilledFields, useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { today } from "@/lib/today";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

function Submit() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.evaluation.addReview.submit}</Button>;
}

/** Admin-only: adds one performance-evaluation entry (period, a rating from the Settings scale, an optional comment). */
export function AddReviewDialog({ employeeId, scale }: { employeeId: string; scale: { id: string; label: string }[] }) {
  const t = useT();
  const a = t.evaluation.addReview;
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(addEvaluationReview, {});
  useActionFeedback(state, () => setOpen(false));

  if (scale.length === 0) {
    return <p className="text-sm text-muted-foreground">{a.noRatingsYet}</p>;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" />{a.button}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{a.title}</DialogTitle></DialogHeader>
        <form action={formAction} ref={keepFilledFields} className="flex flex-col gap-4">
          <input type="hidden" name="employeeId" value={employeeId} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="review-period">{a.periodLabelLabel}</Label>
              <Input id="review-period" name="periodLabel" maxLength={60} required placeholder={a.periodLabelHint} aria-invalid={state.fields?.includes("periodLabel")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="review-date">{a.periodDateLabel}</Label>
              <Input id="review-date" name="periodDate" type="date" dir="ltr" defaultValue={today()} required aria-invalid={state.fields?.includes("periodDate")} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="review-rating">{a.ratingLabel}</Label>
            <Select name="scaleItemId">
              <SelectTrigger id="review-rating" aria-invalid={state.fields?.includes("scaleItemId")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {scale.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="review-comment">{a.commentLabel}</Label>
            <Textarea id="review-comment" name="comment" maxLength={2000} />
          </div>
          <DialogFooter><Submit /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
