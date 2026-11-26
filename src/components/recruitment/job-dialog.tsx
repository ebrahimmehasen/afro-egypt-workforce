"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Plus } from "lucide-react";
import { saveJob } from "@/lib/actions/recruitment";
import { keepFilledFields, useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export interface JobView {
  id: string;
  title: string;
  description: string;
  open: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  showSalary: boolean;
  sortOrder: number;
}

function Submit() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.recruitment.admin.save}</Button>;
}

/** Add a job (no `job`) or edit one: open or closed, and an optional salary range that is shown to applicants only when switched on. */
export function JobDialog({ job }: { job?: JobView }) {
  const t = useT();
  const r = t.recruitment.admin.jobs;
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(saveJob, {});
  useActionFeedback(state, () => setOpen(false));
  const bad = (name: string) => state.fields?.includes(name);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size={job ? "sm" : "default"} variant={job ? "outline" : "default"} className="gap-1.5">
          {job ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-4 w-4" />}
          {job ? r.edit : r.add}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{job ? r.edit : r.add}</DialogTitle></DialogHeader>
        <form action={formAction} ref={keepFilledFields} className="flex flex-col gap-4">
          {job && <input type="hidden" name="id" value={job.id} />}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="job-title">{r.titleLabel}</Label>
            <Input id="job-title" name="title" defaultValue={job?.title} required aria-invalid={bad("title")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="job-desc">{r.descriptionLabel}</Label>
            <Textarea id="job-desc" name="description" defaultValue={job?.description} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="job-min">{r.salaryMin} <span className="text-xs text-muted-foreground">({r.salaryOptional})</span></Label>
              <Input id="job-min" name="salaryMin" type="number" min={0} dir="ltr" defaultValue={job?.salaryMin ?? ""} aria-invalid={bad("salaryMin")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="job-max">{r.salaryMax} <span className="text-xs text-muted-foreground">({r.salaryOptional})</span></Label>
              <Input id="job-max" name="salaryMax" type="number" min={0} dir="ltr" defaultValue={job?.salaryMax ?? ""} aria-invalid={bad("salaryMax")} />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="showSalary" defaultChecked={job?.showSalary ?? false} className="mt-1" />
            <span>{r.showSalary}<span className="block text-xs text-muted-foreground">{r.showSalaryHint}</span></span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="open" defaultChecked={job?.open ?? true} />
            {r.openLabel}
          </label>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="job-order">{r.sortOrder}</Label>
            <Input id="job-order" name="sortOrder" type="number" min={0} dir="ltr" defaultValue={job?.sortOrder ?? 0} className="w-28" />
          </div>
          <DialogFooter><Submit /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
