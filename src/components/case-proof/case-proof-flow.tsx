"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Camera, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { addCaseProofPhotos, discardCaseProof, removeCaseProofPhoto, saveCaseProof } from "@/lib/actions/case-proof";
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

export interface CasePhoto {
  id: string;
  position: number;
}

/**
 * The thumbnail grid of a case's current photos, with the ONE combined AI draft shown underneath — clearly labelled as a
 * suggestion, never the record. Every add or remove re-reads the full current set and refreshes that draft right here
 * (it never touches the saved finalText — see ai-draft.ts and the server actions). Read only (no remove control, no
 * "add more", no AI status line) when `canEdit` is false; a lone photo has no remove control either way.
 */
export function CasePhotos({ caseId, photos, canEdit, initialDraft = null }: { caseId: string; photos: CasePhoto[]; canEdit: boolean; initialDraft?: string | null }) {
  const t = useT();
  const c = t.caseProof;
  const [list, setList] = useState(photos);
  const [draft, setDraft] = useState(initialDraft);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    setError(null);
    if (list.length + files.length > L.maxPhotosPerCase) return setError(c.errors.tooManyPhotos);
    const form = new FormData();
    for (const file of files) form.append("photo", file);
    setBusy("add");
    const result = await addCaseProofPhotos(caseId, form);
    setBusy(null);
    if (result.error) return setError(result.error);
    if (result.photos) setList(result.photos);
    setDraft(result.draft ?? null);
  }

  async function handleRemove(photoId: string) {
    if (!window.confirm(c.removePhotoConfirm)) return;
    setError(null);
    setBusy(photoId);
    const result = await removeCaseProofPhoto(caseId, photoId);
    setBusy(null);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.photos) setList(result.photos);
    setDraft(result.draft ?? null);
  }

  return (
    <div className="flex flex-col gap-2">
      {list.length === 0 ? (
        // a legacy case predating the photos table (or awaiting its backfilled row): its one photo is still served by
        // the original single-photo route, which keeps working unchanged
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/case-proof/${caseId}/photo`} alt={c.photoAlt} className="max-h-96 w-full rounded-lg border object-contain" data-testid="legacy-photo" />
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid="case-photos-grid">
          {list.map((p) => (
            <div key={p.id} className="group relative aspect-square overflow-hidden rounded-md border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/case-proof/${caseId}/photos/${p.id}`} alt={c.photoAlt} className="h-full w-full object-cover" />
              {canEdit && list.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleRemove(p.id)}
                  disabled={busy !== null}
                  aria-label={c.removePhoto}
                  data-testid="remove-photo"
                  className="absolute end-1 top-1 rounded-full bg-background/90 p-1 text-destructive opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span data-testid="photos-count">{format(c.photosCount, { count: list.length })}</span>
        {canEdit && list.length < L.maxPhotosPerCase && (
          <label className="cursor-pointer text-primary hover:underline">
            {busy === "add" ? c.addingPhotos : c.addMorePhotos}
            <input type="file" accept={CASE_PHOTO_ACCEPT_ATTR} multiple className="sr-only" onChange={handleAdd} disabled={busy !== null} />
          </label>
        )}
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      {canEdit &&
        (draft ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm" data-testid="ai-suggestion"><span className="font-medium">{c.aiSuggestionLabel}:</span> {draft}</p>
        ) : (
          <p className="rounded-md bg-warning/10 px-3 py-2 text-sm" role="status">{c.aiUnavailable}</p>
        ))}
    </div>
  );
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
  // one employee or a group: the picked ids live here, so they survive the filter box hiding some rows
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [created, setCreated] = useState<{ id: string; draft: string | null; aiAvailable: boolean; photos: CasePhoto[] } | null>(null);

  const errorText = (code: string) => (c.errors as Record<string, string>)[code] ?? c.errors.generic;

  async function onUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (selected.length === 0) return setError(c.errors.pickOne);
    if (selected.length > L.maxEmployeesPerCase) return setError(c.errors.tooManyEmployees);
    const form = new FormData(event.currentTarget);
    const photos = form.getAll("photo").filter((f): f is File => f instanceof File && f.size > 0);
    if (photos.length === 0) return setError(c.errors.empty);
    if (photos.length > L.maxPhotosPerCase) return setError(c.errors.tooManyPhotos);
    if (photos.some((p) => p.size > L.maxPhotoBytes)) return setError(c.errors.size);
    setUploading(true);
    try {
      const res = await fetch("/api/case-proof", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { id?: string; draft?: string | null; aiAvailable?: boolean; error?: string; photos?: CasePhoto[] };
      if (!res.ok || !body.id) return setError(errorText(body.error ?? "generic"));
      setCreated({ id: body.id, draft: body.draft ?? null, aiAvailable: Boolean(body.aiAvailable), photos: body.photos ?? [] });
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
          <CasePhotos caseId={created.id} photos={created.photos} canEdit initialDraft={created.draft} />
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold">{c.step2}</h2>
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
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="cp-filter">{c.employeesLabel}</Label>
          <span className="text-xs text-muted-foreground" data-testid="selected-count">{format(c.selectedCount, { count: selected.length })}</span>
        </div>
        <p className="text-xs text-muted-foreground">{c.employeesHint}</p>
        {selected.map((id) => <input key={id} type="hidden" name="employeeId" value={id} />)}
        <Input id="cp-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={c.chooseEmployee} />
        <div className="max-h-56 overflow-y-auto rounded-md border border-input p-1" role="group" aria-label={c.employeesLabel}>
          {employees
            .filter((e) => !filter.trim() || `${e.name} ${e.employeeNumber}`.toLowerCase().includes(filter.trim().toLowerCase()))
            .map((e) => (
              <label key={e.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                <input
                  type="checkbox"
                  checked={selected.includes(e.id)}
                  onChange={(ev) => setSelected((cur) => (ev.target.checked ? [...cur, e.id] : cur.filter((x) => x !== e.id)))}
                />
                {e.name} — {e.employeeNumber}
              </label>
            ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cp-photo">{c.photoLabel}</Label>
        <Input id="cp-photo" name="photo" type="file" accept={CASE_PHOTO_ACCEPT_ATTR} capture="environment" multiple required />
        <p className="text-xs text-muted-foreground">{format(c.photoHint, { size: Math.round(L.maxPhotoBytes / (1024 * 1024)), max: L.maxPhotosPerCase })}</p>
      </div>
      <p className="text-xs text-muted-foreground">{c.aiPrivacy}</p>
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
      <Button type="submit" disabled={uploading || employees.length === 0} className="w-full sm:w-fit">{uploading ? c.uploading : c.upload}</Button>
    </form>
  );
}
