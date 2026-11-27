"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Award, ListOrdered, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteEvaluationScaleItem, deleteJobLevel, saveEvaluationScaleItem, saveJobLevel } from "@/lib/actions/evaluation";
import { keepFilledFields, useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { format } from "@/lib/i18n/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export interface JobLevelRow {
  id: string;
  name: string;
  sortOrder: number;
  inUse: boolean;
}
export interface ScaleItemRow {
  id: string;
  label: string;
  sortOrder: number;
  inUse: boolean;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.common.save}</Button>;
}

function DeleteRowButton({ title, confirm, run }: { title: string; confirm: string; run: () => Promise<{ error?: string; message?: string }> }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" aria-label={t.common.delete} disabled={pending}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              startTransition(async () => {
                const res = await run();
                if (res.error) toast.error(res.error);
                else toast.success(res.message ?? t.evaluation.settings.deleted);
              })
            }
          >
            {t.common.delete}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function JobLevelDialog({ level }: { level?: JobLevelRow }) {
  const t = useT();
  const e = t.evaluation.settings;
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(saveJobLevel, {});
  useActionFeedback(state, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {level ? (
          <Button size="icon" variant="ghost" aria-label={e.editLevel}><Pencil className="h-4 w-4" /></Button>
        ) : (
          <Button className="gap-2"><Plus className="h-4 w-4" />{e.addLevel}</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{level ? e.editLevel : e.addLevel}</DialogTitle></DialogHeader>
        <form action={formAction} ref={keepFilledFields} className="flex flex-col gap-4">
          {level && <input type="hidden" name="id" value={level.id} />}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="level-name">{e.levelNameLabel}</Label>
            <Input id="level-name" name="name" defaultValue={level?.name ?? ""} maxLength={80} required aria-invalid={state.fields?.includes("name")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="level-order">{e.levelOrderLabel}</Label>
            <Input id="level-order" name="sortOrder" type="number" min={0} dir="ltr" defaultValue={level?.sortOrder ?? 0} required />
          </div>
          <DialogFooter><SubmitButton /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The job-level list (admin only) a manager chooses an employee's level from — no salary range, no pay link. */
export function JobLevelsSection({ levels }: { levels: JobLevelRow[] }) {
  const t = useT();
  const e = t.evaluation.settings;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2"><Award className="h-5 w-5 text-primary" />{e.jobLevelsTitle}</CardTitle>
          <CardDescription>{e.jobLevelsDesc}</CardDescription>
        </div>
        <JobLevelDialog />
      </CardHeader>
      <CardContent>
        {levels.length === 0 ? (
          <p className="text-sm text-muted-foreground">{e.noLevels}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {levels.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                    {l.name}
                    {l.inUse && <Badge variant="outline">{e.inUse}</Badge>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <JobLevelDialog level={l} />
                  <DeleteRowButton title={e.deleteLevel} confirm={format(e.deleteLevelConfirm, { name: l.name })} run={() => deleteJobLevel(l.id)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ScaleItemDialog({ item }: { item?: ScaleItemRow }) {
  const t = useT();
  const e = t.evaluation.settings;
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(saveEvaluationScaleItem, {});
  useActionFeedback(state, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {item ? (
          <Button size="icon" variant="ghost" aria-label={e.editScaleItem}><Pencil className="h-4 w-4" /></Button>
        ) : (
          <Button className="gap-2"><Plus className="h-4 w-4" />{e.addScaleItem}</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{item ? e.editScaleItem : e.addScaleItem}</DialogTitle></DialogHeader>
        <form action={formAction} ref={keepFilledFields} className="flex flex-col gap-4">
          {item && <input type="hidden" name="id" value={item.id} />}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scale-label">{e.scaleLabelLabel}</Label>
            <Input id="scale-label" name="label" defaultValue={item?.label ?? ""} maxLength={80} required aria-invalid={state.fields?.includes("label")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scale-order">{e.scaleOrderLabel}</Label>
            <Input id="scale-order" name="sortOrder" type="number" min={0} dir="ltr" defaultValue={item?.sortOrder ?? 0} required />
          </div>
          <DialogFooter><SubmitButton /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The rating scale (admin only) a performance evaluation's rating is chosen from — labels and order only, never hardcoded. */
export function EvaluationScaleSection({ items }: { items: ScaleItemRow[] }) {
  const t = useT();
  const e = t.evaluation.settings;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2"><ListOrdered className="h-5 w-5 text-primary" />{e.scaleTitle}</CardTitle>
          <CardDescription>{e.scaleDesc}</CardDescription>
        </div>
        <ScaleItemDialog />
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{e.noScaleItems}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {items.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                    {s.label}
                    {s.inUse && <Badge variant="outline">{e.inUse}</Badge>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <ScaleItemDialog item={s} />
                  <DeleteRowButton title={e.deleteScaleItem} confirm={format(e.deleteScaleItemConfirm, { name: s.label })} run={() => deleteEvaluationScaleItem(s.id)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
