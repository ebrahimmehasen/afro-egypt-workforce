"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Camera, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { discardCaseProof, saveCaseProof } from "@/lib/actions/case-proof";
import { keepFilledFields, useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { format } from "@/lib/i18n/format";
import { CASE_PHOTO_ACCEPT_ATTR, CASE_PROOF_LIMITS as L } from "@/lib/case-proof/config";

export interface PickEmployee {
  id: string;
  name: string;
  employeeNumber: string;
}

function SaveButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.caseProof.saving : t.caseProof.save}</Button>;
}

/** The description of a case: the AI draft (clearly labelled) or an empty field, always editable, saved by the supervisor. */
export function CaseTextForm({ id, initial, aiGenerated, onSaved, onDiscard }: { id: string; initial: string; aiGenerated: boolean; onSaved?: () => void; onDiscard?: () => void }) {
  const t = useT();
  const c = t.caseProof;
  const [state, formAction] = useActionState(saveCaseProof, {});
  useActionFeedback(state, onSaved);
  return (
    <form action={formAction} ref={keepFilledFields} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`cp-text-${id}`}>{c.textLabel}</Label>
        {aiGenerated && (
          <Badge variant="gold" className="gap-1" data-testid="ai-draft-badge"><Sparkles className="h-3 w-3" />{c.aiDraftBadge}</Badge>
        )}
      </div>
      <Textarea id={`cp-text-${id}`} name="text" defaultValue={initial} rows={6} minLength={3} maxLength={L.maxTextLength} required placeholder={c.textHint} aria-invalid={state.fields?.includes("text")} />
      <div className="flex flex-wrap items-center gap-2">
        <SaveButton />
        {onDiscard && <Button type="button" variant="ghost" className="text-destructive" onClick={onDiscard}>{c.discard}</Button>}
      </div>
    </form>
  );
}

/** Choose the employee, upload the photo, see the AI draft (or an empty field), edit it, save. */
export function CaseProofFlow({ employees }: { employees: PickEmployee[] }) {
  const t = useT();
  const c = t.caseProof;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; draft: string | null; aiAvailable: boolean } | null>(null);

  const errorText = (code: string) => (c.errors as Record<string, string>)[code] ?? c.errors.generic;

  async function onUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const photo = form.get("photo");
    if (!(photo instanceof File) || photo.size === 0) return setError(c.errors.empty);
    if (photo.size > L.maxPhotoBytes) return setError(c.errors.size);
    setUploading(true);
    try {
      const res = await fetch("/api/case-proof", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { id?: string; draft?: string | null; aiAvailable?: boolean; error?: string };
      if (!res.ok || !body.id) return setError(errorText(body.error ?? "generic"));
      setCreated({ id: body.id, draft: body.draft ?? null, aiAvailable: Boolean(body.aiAvailable) });
    } catch {
      setError(c.errors.generic);
    } finally {
      setUploading(false);
    }
  }

  function discard() {
    if (!created || !window.confirm(c.discardConfirm)) return;
    startTransition(async () => {
      const result = await discardCaseProof(created.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(c.discarded);
      setCreated(null);
      router.refresh();
    });
  }

  if (created) {
    return (
      <div className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-2" data-testid="case-review">
        <div className="flex flex-col gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/case-proof/${created.id}/photo`} alt={c.photoAlt} className="max-h-96 w-full rounded-lg border object-contain" />
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold">{c.step2}</h2>
          {!created.aiAvailable && <p className="rounded-md bg-warning/10 px-3 py-2 text-sm" role="status">{c.aiUnavailable}</p>}
          <CaseTextForm
            id={created.id}
            initial={created.draft ?? ""}
            aiGenerated={created.aiAvailable}
            onSaved={() => {
              setCreated(null);
              router.refresh();
            }}
            onDiscard={pending ? undefined : discard}
          />
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onUpload} className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <h2 className="flex items-center gap-2 font-semibold"><Camera className="h-4 w-4" />{c.newCase}</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cp-employee">{c.employeeLabel}</Label>
        <select id="cp-employee" name="employeeId" required defaultValue="" className="h-10 rounded-md border border-input bg-background px-3 text-sm">
          <option value="" disabled>{c.chooseEmployee}</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.employeeNumber}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cp-photo">{c.photoLabel}</Label>
        <Input id="cp-photo" name="photo" type="file" accept={CASE_PHOTO_ACCEPT_ATTR} capture="environment" required />
        <p className="text-xs text-muted-foreground">{format(c.photoHint, { size: Math.round(L.maxPhotoBytes / (1024 * 1024)) })}</p>
      </div>
      <p className="text-xs text-muted-foreground">{c.aiPrivacy}</p>
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
      <Button type="submit" disabled={uploading || employees.length === 0} className="w-full sm:w-fit">{uploading ? c.uploading : c.upload}</Button>
    </form>
  );
}
