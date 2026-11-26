"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { format } from "@/lib/i18n/format";
import { APPLICATION_ACCEPT_ATTR, HONEYPOT_FIELD, RECRUITMENT_LIMITS as L } from "@/lib/recruitment/config";
import type { FieldType } from "@/lib/recruitment/form-config";

export interface ApplyFieldView {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: { value: string; label: string }[];
}
export interface ApplyJobView {
  id: string;
  title: string;
  description: string | null;
  /** Already worded, and only present when HR chose to show the salary. */
  salaryText: string | null;
}

const selectCls = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

/**
 * The public application form. It renders exactly the fields the server sent (HR's configuration) and posts them to
 * /api/apply; the server validates against the same configuration, so nothing here is trusted.
 */
export function ApplyForm({ jobs, fields }: { jobs: ApplyJobView[]; fields: ApplyFieldView[] }) {
  const t = useT();
  const a = t.recruitment.apply;
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const errorText = (code: string) => (a.errors as Record<string, string>)[code] ?? a.errors.generic;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setFieldErrors({});
    const form = new FormData(event.currentTarget);
    // the same limits the server enforces, so a person hears about a large file before waiting for the upload
    let total = 0;
    for (const f of fields.filter((x) => x.type === "file")) {
      const files = form.getAll(f.key).filter((x): x is File => x instanceof File && x.size > 0);
      total += files.length;
      if (files.some((x) => x.size > L.maxFileBytes)) return setFieldErrors({ [f.key]: "fileSize" });
    }
    if (total > L.maxFiles) return setMessage(errorText("tooManyFiles"));

    setPending(true);
    try {
      const res = await fetch("/api/apply", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; fields?: Record<string, string> };
      if (res.ok && body.ok) return setDone(true);
      setMessage(errorText(body.error ?? "generic"));
      setFieldErrors(body.fields ?? {});
    } catch {
      setMessage(a.errors.generic);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center shadow-sm" data-testid="apply-success">
        <CheckCircle2 className="h-10 w-10 text-success" />
        <h2 className="text-lg font-bold">{a.successTitle}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{a.successBody}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">{a.openJobs}</h2>
        {jobs.length === 0 ? (
          <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{a.noOpenJobs}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {jobs.map((job) => (
              <div key={job.id} className={`flex flex-col gap-1.5 rounded-lg border bg-card p-4 ${job.id === jobId ? "border-primary ring-1 ring-primary" : ""}`}>
                <h3 className="font-semibold">{job.title}</h3>
                {job.description && <p className="text-sm text-muted-foreground">{job.description}</p>}
                {job.salaryText && <p className="text-sm font-medium">{job.salaryText}</p>}
                <Button type="button" size="sm" variant={job.id === jobId ? "default" : "outline"} className="mt-1 w-fit" onClick={() => setJobId(job.id)}>
                  {a.applyForThis}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {jobs.length > 0 && (
        <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm" noValidate>
          {/* the trap: hidden from people, filled by bots. Must stay empty. */}
          <div aria-hidden="true" style={{ position: "absolute", insetInlineStart: 0, top: 0, width: 0, height: 0, overflow: "hidden", opacity: 0, pointerEvents: "none" }}>
            <label>
              {a.leaveEmpty}
              <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
            </label>
          </div>

          {fields.map((f) => {
            const id = `apply-${f.key}`;
            const err = fieldErrors[f.key];
            return (
              <div key={f.key} className="flex flex-col gap-1.5">
                <Label htmlFor={id}>
                  {f.label}
                  {!f.required && <span className="ms-1 text-xs font-normal text-muted-foreground">({a.optional})</span>}
                </Label>
                {f.key === "job" ? (
                  <select id={id} name="job" value={jobId} onChange={(e) => setJobId(e.target.value)} className={selectCls} required>
                    {jobs.map((j) => (
                      <option key={j.id} value={j.id}>{j.title}</option>
                    ))}
                  </select>
                ) : f.type === "longtext" ? (
                  <Textarea id={id} name={f.key} required={f.required} maxLength={L.maxExperience} />
                ) : f.type === "select" ? (
                  <select id={id} name={f.key} className={selectCls} required={f.required} defaultValue="">
                    <option value="">{a.selectPlaceholder}</option>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : f.type === "file" ? (
                  <>
                    <Input id={id} name={f.key} type="file" multiple accept={APPLICATION_ACCEPT_ATTR} required={f.required} />
                    <p className="text-xs text-muted-foreground">{format(a.fileHint, { size: Math.round(L.maxFileBytes / (1024 * 1024)), count: L.maxFiles })}</p>
                  </>
                ) : (
                  <Input
                    id={id}
                    name={f.key}
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.key === "email" ? "email" : f.key === "phone" ? "tel" : "text"}
                    min={f.type === "number" ? 0 : undefined}
                    dir={f.type === "number" || f.key === "phone" || f.key === "nationalId" || f.key === "email" ? "ltr" : undefined}
                    required={f.required}
                  />
                )}
                {err && <p className="text-xs text-destructive">{errorText(err)}</p>}
              </div>
            );
          })}

          {message && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{message}</p>}
          <Button type="submit" disabled={pending} className="w-full sm:w-fit">{pending ? a.sending : a.submit}</Button>
        </form>
      )}
    </div>
  );
}
