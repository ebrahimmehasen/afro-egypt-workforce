"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { useActionState } from "react";
import { toast } from "sonner";
import { FileSignature, Printer, Trash2, Upload, CheckCircle2, Clock } from "lucide-react";
import { ACKNOWLEDGMENT_TYPES, AcknowledgmentType, EmployeeAcknowledgment } from "@/lib/types";
import { generateAcknowledgment, deleteAcknowledgment } from "@/lib/actions/acknowledgments";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { intlLocale } from "@/lib/i18n/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

const selectCls = "h-10 rounded-md border border-input bg-background px-3 text-sm";

function GenerateButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <Button type="submit" disabled={pending} className="gap-2">
      <FileSignature className="h-4 w-4" />
      {pending ? t.common.saving : t.acknowledgments.generate}
    </Button>
  );
}

export function AcknowledgmentsPanel({
  employeeId,
  acknowledgments,
  canManage,
}: {
  employeeId: string;
  acknowledgments: EmployeeAcknowledgment[];
  canManage: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<AcknowledgmentType>("employment_terms");
  const [busy, setBusy] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [state, formAction] = useActionState(generateAcknowledgment, {});
  useActionFeedback(state, () => {
    setOpen(false);
    router.refresh();
  });

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(intlLocale(locale), { year: "numeric", month: "short", day: "numeric" });

  async function uploadSigned(ackId: string, file: File) {
    setBusy(ackId);
    try {
      const fd = new FormData();
      fd.set("ackId", ackId);
      fd.set("file", file);
      const res = await fetch(`/api/employees/${employeeId}/acknowledgments`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "upload failed");
      toast.success(t.acknowledgments.signedUploaded);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.documents.uploadFailed);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      const res = await deleteAcknowledgment(id);
      if (res?.error) throw new Error(res.error);
      toast.success(t.acknowledgments.deleted);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.common.noData);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t.acknowledgments.title}</h3>
          {canManage && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-2">
                  <FileSignature className="h-4 w-4" />
                  {t.acknowledgments.new}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{t.acknowledgments.new}</DialogTitle></DialogHeader>
                <form action={formAction} className="flex flex-col gap-4">
                  <input type="hidden" name="employeeId" value={employeeId} />
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ack-type">{t.acknowledgments.type}</Label>
                    <select
                      id="ack-type"
                      name="type"
                      value={type}
                      onChange={(e) => setType(e.target.value as AcknowledgmentType)}
                      className={selectCls}
                    >
                      {ACKNOWLEDGMENT_TYPES.map((ty) => (
                        <option key={ty} value={ty}>{t.acknowledgments.types[ty]}</option>
                      ))}
                    </select>
                  </div>
                  {type === "other" && (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="ack-custom">{t.acknowledgments.customText}</Label>
                      <Textarea id="ack-custom" name="customText" rows={4} required />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">{t.acknowledgments.flowHint}</p>
                  <DialogFooter><GenerateButton /></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {acknowledgments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t.acknowledgments.none}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {acknowledgments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.acknowledgments.types[a.type]}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.acknowledgments.generatedAt}: {fmt(a.generatedAt)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {a.signedAt ? (
                    <Badge variant="success" className="gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t.acknowledgments.signedOn} {fmt(a.signedAt)}
                    </Badge>
                  ) : (
                    <Badge variant="warning" className="gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {t.acknowledgments.awaitingSignature}
                    </Badge>
                  )}

                  <a href={`/acknowledgment/${a.id}`} target="_blank" rel="noopener noreferrer">
                    <Button size="icon" variant="ghost" aria-label={t.acknowledgments.print}>
                      <Printer className="h-4 w-4" />
                    </Button>
                  </a>
                  {a.fileUrl && (
                    <a href={a.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">
                      {t.acknowledgments.signedCopy}
                    </a>
                  )}

                  {canManage && (
                    <>
                      <input
                        ref={(el) => {
                          inputs.current[a.id] = el;
                        }}
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadSigned(a.id, f);
                          e.target.value = "";
                        }}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t.acknowledgments.uploadSigned}
                        disabled={busy === a.id}
                        onClick={() => inputs.current[a.id]?.click()}
                      >
                        <Upload className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        aria-label={t.common.delete}
                        disabled={busy === a.id}
                        onClick={() => void remove(a.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
