"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, FileCheck2, FileWarning, Trash2, Upload } from "lucide-react";
import { EMPLOYEE_DOCUMENT_TYPES, EmployeeDocument, EmployeeDocumentType } from "@/lib/types";
import { ACCEPTED_DOCUMENT_MIME, canBeRequired } from "@/lib/documents";
import { setDocumentRequired } from "@/lib/actions/employee-documents";
import { useT } from "@/components/providers/locale-provider";
import { FilePreview } from "@/components/employees/file-preview";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export function DocumentsPanel({
  employeeId,
  documents,
  requiredTypes,
  canManage,
}: {
  employeeId: string;
  documents: EmployeeDocument[];
  /** This employee's own required document types (custom list, else the company default). */
  requiredTypes: EmployeeDocumentType[];
  canManage: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const byType = new Map<EmployeeDocumentType, EmployeeDocument[]>();
  for (const d of documents) {
    const list = byType.get(d.type);
    if (list) list.push(d);
    else byType.set(d.type, [d]);
  }

  const missing = requiredTypes.filter((ty) => !byType.has(ty));
  // Optional slots only clutter the list when empty — managers still see them all,
  // since that's where a document is moved into the required list from.
  const optionalShown = EMPLOYEE_DOCUMENT_TYPES.filter(
    (ty) => !requiredTypes.includes(ty) && (byType.has(ty) || canManage),
  );

  async function upload(type: EmployeeDocumentType, file: File) {
    setBusy(type);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("type", type);
      const res = await fetch(`/api/employees/${employeeId}/documents`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "upload failed");
      toast.success(t.documents.uploaded);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.documents.uploadFailed);
    } finally {
      setBusy(null);
    }
  }

  async function remove(doc: EmployeeDocument) {
    setBusy(doc.id);
    try {
      const res = await fetch(`/api/employees/${employeeId}/documents?docId=${doc.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "delete failed");
      toast.success(t.documents.deleted);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.common.noData);
    } finally {
      setBusy(null);
    }
  }

  async function toggleRequired(type: EmployeeDocumentType, required: boolean) {
    setBusy(`req:${type}`);
    try {
      const res = await setDocumentRequired(employeeId, type, required);
      if (res.error) throw new Error(res.error);
      toast.success(res.message ?? t.documents.requirementSaved);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.documents.uploadFailed);
    } finally {
      setBusy(null);
    }
  }

  function renderSlot(type: EmployeeDocumentType, required: boolean) {
    const files = byType.get(type) ?? [];
    return (
      <li key={type} className="flex flex-col gap-1.5 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {files.length > 0 ? (
              <FileCheck2 className="h-4 w-4 shrink-0 text-success" />
            ) : (
              <FileWarning className={`h-4 w-4 shrink-0 ${required ? "text-warning" : "text-muted-foreground"}`} />
            )}
            <p className="truncate text-sm font-medium">{t.documents.types[type]}</p>
            {files.length > 1 && <Badge variant="secondary">{files.length}</Badge>}
          </div>

          {canManage && (
            <div className="flex shrink-0 items-center gap-1.5">
              {canBeRequired(type) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1 px-2 text-xs text-muted-foreground"
                  disabled={busy === `req:${type}`}
                  onClick={() => void toggleRequired(type, !required)}
                >
                  {required ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}
                  {required ? t.documents.makeOptional : t.documents.makeRequired}
                </Button>
              )}
              <input
                ref={(el) => {
                  inputs.current[type] = el;
                }}
                type="file"
                accept={ACCEPTED_DOCUMENT_MIME.join(",")}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(type, f);
                  e.target.value = "";
                }}
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label={t.documents.upload}
                disabled={busy === type}
                onClick={() => inputs.current[type]?.click()}
              >
                <Upload className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {files.length > 0 && (
          <ul className="flex flex-col gap-1 ps-6">
            {files.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-2">
                <p className="truncate text-xs text-muted-foreground">{doc.fileName ?? doc.fileUrl}</p>
                <div className="flex shrink-0 items-center gap-1">
                  <FilePreview url={doc.fileUrl} name={doc.fileName} mime={doc.mimeType} />
                  {canManage && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive"
                      aria-label={t.common.delete}
                      disabled={busy === doc.id}
                      onClick={() => void remove(doc)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t.documents.title}</h3>
          {missing.length === 0 ? (
            <Badge variant="success" className="gap-1"><FileCheck2 className="h-3.5 w-3.5" />{t.documents.complete}</Badge>
          ) : (
            <Badge variant="warning" className="gap-1">
              <FileWarning className="h-3.5 w-3.5" />
              {t.documents.incomplete} ({missing.length})
            </Badge>
          )}
        </div>

        {requiredTypes.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground">{t.documents.requiredSection}</p>
            <ul className="flex flex-col divide-y divide-border">
              {requiredTypes.map((type) => renderSlot(type, true))}
            </ul>
          </>
        )}

        {optionalShown.length > 0 && (
          <>
            <p className="mt-2 text-xs text-muted-foreground">{t.documents.optionalSection}</p>
            <ul className="flex flex-col divide-y divide-border">
              {optionalShown.map((type) => renderSlot(type, false))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
