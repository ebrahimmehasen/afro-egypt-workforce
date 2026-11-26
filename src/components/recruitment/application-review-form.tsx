"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateApplication } from "@/lib/actions/recruitment";
import { keepFilledFields, useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { APPLICATION_STATUSES } from "@/lib/recruitment/config";

function Submit() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.recruitment.admin.save}</Button>;
}

/** Status and an internal note for one application (audited by the action). */
export function ApplicationReviewForm({ id, status, note }: { id: string; status: string; note: string }) {
  const t = useT();
  const r = t.recruitment.admin;
  const [state, formAction] = useActionState(updateApplication, {});
  useActionFeedback(state);
  return (
    <form action={formAction} ref={keepFilledFields} className="flex h-fit flex-col gap-4 rounded-lg border bg-card p-4">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="app-status">{r.statusLabel}</Label>
        <select id="app-status" name="status" defaultValue={status} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          {APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{r.statuses[s]}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="app-note">{r.noteLabel}</Label>
        <Textarea id="app-note" name="note" defaultValue={note} maxLength={4000} rows={5} />
      </div>
      <Submit />
    </form>
  );
}
