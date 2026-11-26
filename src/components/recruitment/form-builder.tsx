"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { ArrowDown, ArrowUp, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { addFormQuestion, moveFormField, removeFormQuestion, saveFormField } from "@/lib/actions/recruitment";
import { keepFilledFields, useActionFeedback } from "@/hooks/use-action-feedback";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FIELD_TYPES, type FieldType } from "@/lib/recruitment/form-config";

export interface BuilderField {
  key: string;
  labelAr: string;
  labelEn: string;
  type: FieldType;
  required: boolean;
  visible: boolean;
  sortOrder: number;
  builtin: boolean;
  custom: boolean;
  optionsText: string;
}

function Submit() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.recruitment.admin.save}</Button>;
}

/** Edit one field: labels in both languages, shown / required (locked for the core fields), and the options of a custom select. */
function FieldDialog({ field }: { field: BuilderField }) {
  const t = useT();
  const f = t.recruitment.admin.form;
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(saveFormField, {});
  useActionFeedback(state, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-1.5"><Pencil className="h-3.5 w-3.5" />{f.edit}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{field.labelAr}</DialogTitle></DialogHeader>
        <form action={formAction} ref={keepFilledFields} className="flex flex-col gap-4">
          <input type="hidden" name="key" value={field.key} />
          <input type="hidden" name="sortOrder" value={field.sortOrder} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`fa-${field.key}`}>{f.labelAr}</Label>
            <Input id={`fa-${field.key}`} name="labelAr" defaultValue={field.labelAr} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`fe-${field.key}`}>{f.labelEn}</Label>
            <Input id={`fe-${field.key}`} name="labelEn" defaultValue={field.labelEn} required dir="ltr" />
          </div>
          {field.builtin ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Lock className="h-3.5 w-3.5" />{f.locked}</p>
          ) : (
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="visible" defaultChecked={field.visible} />{f.visible}</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="required" defaultChecked={field.required} />{f.required}</label>
            </div>
          )}
          {field.custom && field.type === "select" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`fo-${field.key}`}>{f.optionsLabel}</Label>
              <Textarea id={`fo-${field.key}`} name="optionsText" defaultValue={field.optionsText} rows={5} />
              <p className="text-xs text-muted-foreground">{f.optionsHint}</p>
            </div>
          )}
          <DialogFooter><Submit /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddQuestionDialog() {
  const t = useT();
  const f = t.recruitment.admin.form;
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FieldType>("text");
  const [state, formAction] = useActionState(addFormQuestion, {});
  useActionFeedback(state, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" className="gap-1.5"><Plus className="h-4 w-4" />{f.addQuestion}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{f.addQuestion}</DialogTitle></DialogHeader>
        <form action={formAction} ref={keepFilledFields} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nq-ar">{f.labelAr}</Label>
            <Input id="nq-ar" name="labelAr" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nq-en">{f.labelEn}</Label>
            <Input id="nq-en" name="labelEn" required dir="ltr" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nq-type">{f.typeLabel}</Label>
            <select id="nq-type" name="type" value={type} onChange={(e) => setType(e.target.value as FieldType)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              {FIELD_TYPES.map((x) => <option key={x} value={x}>{f.types[x]}</option>)}
            </select>
          </div>
          {type === "select" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nq-options">{f.optionsLabel}</Label>
              <Textarea id="nq-options" name="optionsText" rows={5} />
              <p className="text-xs text-muted-foreground">{f.optionsHint}</p>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="required" />{f.required}</label>
          <DialogFooter><Submit /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The form's fields in order, each with its flags, move up / down, edit, and (for an extra question only) remove. */
export function FormBuilder({ fields }: { fields: BuilderField[] }) {
  const t = useT();
  const locale = useLocale();
  const f = t.recruitment.admin.form;
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      const result = await action();
      if (result.error) toast.error(result.error);
    });

  return (
    <div className="flex flex-col gap-3">
      <div><AddQuestionDialog /></div>
      <ul className="flex flex-col gap-2">
        {fields.map((field, i) => (
          <li key={field.key} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 ${field.visible ? "" : "opacity-60"}`}>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-medium">{locale === "ar" ? field.labelAr : field.labelEn}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{f.types[field.type]}</Badge>
                {field.builtin && <Badge variant="gold" className="gap-1"><Lock className="h-3 w-3" />{f.locked}</Badge>}
                {field.custom && <Badge variant="secondary">{f.customBadge}</Badge>}
                {field.required && !field.builtin && <Badge variant="default">{f.requiredBadge}</Badge>}
                {!field.visible && <Badge variant="destructive">{f.hiddenBadge}</Badge>}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button type="button" size="icon" variant="ghost" disabled={pending || i === 0} aria-label={f.moveUp} onClick={() => run(() => moveFormField(field.key, "up"))}><ArrowUp className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="ghost" disabled={pending || i === fields.length - 1} aria-label={f.moveDown} onClick={() => run(() => moveFormField(field.key, "down"))}><ArrowDown className="h-4 w-4" /></Button>
              <FieldDialog field={field} />
              {field.custom && (
                <Button type="button" size="sm" variant="ghost" className="gap-1.5 text-destructive" disabled={pending} onClick={() => window.confirm(f.removeConfirm) && run(() => removeFormQuestion(field.key))}>
                  <Trash2 className="h-3.5 w-3.5" />{f.remove}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
