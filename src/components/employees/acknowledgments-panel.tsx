"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, FileCheck2, FileSignature, FileWarning, Plus, Trash2, Upload } from "lucide-react";
import { EmployeeAcknowledgment, STANDARD_ACKNOWLEDGMENT_KEYS, StandardAcknowledgmentKey } from "@/lib/types";
import { ACCEPTED_DOCUMENT_MIME } from "@/lib/documents";
import { canAcknowledgmentBeRequired } from "@/lib/acknowledgments";
import { setAcknowledgmentRequired } from "@/lib/actions/employee-acknowledgments";
import { useT } from "@/components/providers/locale-provider";
import { FilePreview } from "@/components/employees/file-preview";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

type Row = { key: string; label: string; doc?: EmployeeAcknowledgment };

export function AcknowledgmentsPanel({
  employeeId,
  acknowledgments,
  requiredKeys,
  canManage,
}: {
  employeeId: string;
  acknowledgments: EmployeeAcknowledgment[];
  /** This employee's own required-acknowledgment list (see requiredAcknowledgmentKeys). */
  requiredKeys: StandardAcknowledgmentKey[];
  canManage: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const newInput = useRef<HTMLInputElement | null>(null);

  const byKey = new Map(acknowledgments.map((a) => [a.key, a]));
  const toRow = (key: string, label: string): Row => ({ key, label, doc: byKey.get(key) });

  const requiredRows: Row[] = requiredKeys.map((key) => toRow(key, t.acknowledgments.slots[key]));
  const optionalRows: Row[] = [
    ...STANDARD_ACKNOWLEDGMENT_KEYS.filter((key) => !requiredKeys.includes(key)).map((key) => toRow(key, t.acknowledgments.slots[key])),
    ...acknowledgments.filter((a) => a.key.startsWith("custom-")).map((a) => toRow(a.key, a.label)),
  ];
  const missing = requiredKeys.filter((k) => !byKey.has(k));

  async function send(fd: FormData, busyKey: string) {
    setBusy(busyKey);
    try {
      const res = await fetch(`/api/employees/${employeeId}/acknowledgments`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "upload failed");
      toast.success(t.acknowledgments.uploaded);
      setAddOpen(false);
      setNewLabel("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.documents.uploadFailed);
    } finally {
      setBusy(null);
    }
  }

  function uploadInto(key: string, file: File) {
    const fd = new FormData();
    fd.set("key", key);
    fd.set("file", file);
    void send(fd, key);
  }

  function addCustom(file: File) {
    if (!newLabel.trim()) {
      toast.error(t.acknowledgments.nameRequired);
      return;
    }
    const fd = new FormData();
    fd.set("key", "new");
    fd.set("label", newLabel.trim());
    fd.set("file", file);
    void send(fd, "new");
  }

  async function remove(key: string) {
    setBusy(key);
    try {
      const res = await fetch(`/api/employees/${employeeId}/acknowledgments?key=${key}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "delete failed");
      toast.success(t.acknowledgments.deleted);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.common.noData);
    } finally {
      setBusy(null);
    }
  }

  async function toggleRequired(key: string, required: boolean) {
    setBusy(`req:${key}`);
    try {
      const res = await setAcknowledgmentRequired(employeeId, key, required);
      if (res.error) throw new Error(res.error);
      toast.success(res.message ?? t.documents.requirementSaved);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.documents.uploadFailed);
    } finally {
      setBusy(null);
    }
  }

  function renderRow(row: Row, required: boolean) {
    return (
      <li key={row.key} className="flex items-center justify-between gap-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {row.doc ? (
            <FileCheck2 className="h-4 w-4 shrink-0 text-success" />
          ) : (
            <FileSignature className={`h-4 w-4 shrink-0 ${required ? "text-warning" : "text-muted-foreground"}`} />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{row.label}</p>
            {row.doc && (
              <p className="truncate text-xs text-muted-foreground">{row.doc.fileName ?? row.doc.fileUrl}</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {row.doc && <FilePreview url={row.doc.fileUrl} name={row.doc.fileName} mime={row.doc.mimeType} />}
          {canManage && (
            <>
              {canAcknowledgmentBeRequired(row.key) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1 px-2 text-xs text-muted-foreground"
                  disabled={busy === `req:${row.key}`}
                  onClick={() => void toggleRequired(row.key, !required)}
                >
                  {required ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
                  {required ? t.documents.makeOptional : t.documents.makeRequired}
                </Button>
              )}
              <input
                ref={(el) => {
                  inputs.current[row.key] = el;
                }}
                type="file"
                accept={ACCEPTED_DOCUMENT_MIME.join(",")}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadInto(row.key, f);
                  e.target.value = "";
                }}
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label={row.doc ? t.documents.replace : t.documents.upload}
                disabled={busy === row.key}
                onClick={() => inputs.current[row.key]?.click()}
              >
                <Upload className="h-4 w-4" />
              </Button>
              {row.doc && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-destructive"
                  aria-label={t.common.delete}
                  disabled={busy === row.key}
                  onClick={() => void remove(row.key)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
        </div>
      </li>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t.acknowledgments.title}</h3>
          <div className="flex items-center gap-2">
            {missing.length === 0 ? (
              <Badge variant="success" className="gap-1"><FileCheck2 className="h-3.5 w-3.5" />{t.documents.complete}</Badge>
            ) : (
              <Badge variant="warning" className="gap-1">
                <FileWarning className="h-3.5 w-3.5" />
                {t.documents.incomplete} ({missing.length})
              </Badge>
            )}
            {canManage && (
              <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-2">
                    <Plus className="h-4 w-4" />
                    {t.acknowledgments.addCustom}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>{t.acknowledgments.addCustom}</DialogTitle></DialogHeader>
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="ack-label">{t.acknowledgments.name}</Label>
                      <Input
                        id="ack-label"
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder={t.acknowledgments.namePlaceholder}
                      />
                    </div>
                    <input
                      ref={newInput}
                      type="file"
                      accept={ACCEPTED_DOCUMENT_MIME.join(",")}
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) addCustom(f);
                        e.target.value = "";
                      }}
                    />
                    <DialogFooter>
                      <Button
                        className="gap-2"
                        disabled={busy === "new" || !newLabel.trim()}
                        onClick={() => newInput.current?.click()}
                      >
                        <Upload className="h-4 w-4" />
                        {t.acknowledgments.chooseFile}
                      </Button>
                    </DialogFooter>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {requiredRows.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground">{t.acknowledgments.requiredSection}</p>
            <ul className="flex flex-col divide-y divide-border">{requiredRows.map((row) => renderRow(row, true))}</ul>
          </>
        )}

        {optionalRows.length > 0 && (
          <>
            <p className="mt-2 text-xs text-muted-foreground">{t.acknowledgments.optionalSection}</p>
            <ul className="flex flex-col divide-y divide-border">{optionalRows.map((row) => renderRow(row, false))}</ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
