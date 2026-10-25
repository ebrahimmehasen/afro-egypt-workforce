"use client";

import { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import type { ReportRange } from "@/lib/department-report-range";

/**
 * "تصدير Excel": downloads the report for the period on screen from /api/departments/:id/report/export, which
 * checks the session, permission and scope itself. Disabled — with the reason as its tooltip — when the
 * department has no employees within the viewer's access.
 */
export function DepartmentReportExportButton({ departmentId, range, hasEmployees }: { departmentId: string; range: ReportRange; hasEmployees: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  if (!hasEmployees) {
    return (
      <Button variant="outline" className="gap-2" disabled title={t.departmentReport.noData} aria-label={`${t.departmentReport.exportButton} — ${t.departmentReport.noData}`}>
        <FileSpreadsheet className="h-4 w-4" />
        {t.departmentReport.exportButton}
      </Button>
    );
  }

  async function download() {
    setBusy(true);
    try {
      const res = await fetch(`/api/departments/${encodeURIComponent(departmentId)}/report/export?range=${range}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? t.departmentReport.exportFailed);
        return;
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "department-report.xlsx";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t.departmentReport.exportFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" className="gap-2" disabled={busy} aria-busy={busy} onClick={download}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
      {t.departmentReport.exportButton}
    </Button>
  );
}
