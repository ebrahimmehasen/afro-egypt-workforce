"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileCheck2, FileWarning, Trash2, Upload, ExternalLink } from "lucide-react";
import { EMPLOYEE_DOCUMENT_TYPES, EmployeeDocument, EmployeeDocumentType } from "@/lib/types";
import { ACCEPTED_DOCUMENT_MIME } from "@/lib/documents";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export function DocumentsPanel({
  employeeId,
  documents,
  canManage,
}: {
  employeeId: string;
  documents: EmployeeDocument[];
  canManage: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<EmployeeDocumentType | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const byType = new Map(documents.map((d) => [d.type, d]));
  const missing = EMPLOYEE_DOCUMENT_TYPES.filter((ty) => !byType.has(ty));

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

  async function remove(type: EmployeeDocumentType) {
    setBusy(type);
    try {
      const res = await fetch(`/api/employees/${employeeId}/documents?type=${type}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "delete failed");
      toast.success(t.documents.deleted);
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

        <ul className="flex flex-col divide-y divide-border">
          {EMPLOYEE_DOCUMENT_TYPES.map((type) => {
            const doc = byType.get(type);
            return (
              <li key={type} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  {doc ? (
                    <FileCheck2 className="h-4 w-4 shrink-0 text-success" />
                  ) : (
                    <FileWarning className="h-4 w-4 shrink-0 text-warning" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.documents.types[type]}</p>
                    {doc && (
                      <p className="truncate text-xs text-muted-foreground">{doc.fileName ?? doc.fileUrl}</p>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {doc && (
                    <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer">
                      <Button size="icon" variant="ghost" aria-label={t.common.view}>
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </a>
                  )}
                  {canManage && (
                    <>
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
                        aria-label={doc ? t.documents.replace : t.documents.upload}
                        disabled={busy === type}
                        onClick={() => inputs.current[type]?.click()}
                      >
                        <Upload className="h-4 w-4" />
                      </Button>
                      {doc && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive"
                          aria-label={t.common.delete}
                          disabled={busy === type}
                          onClick={() => void remove(type)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
