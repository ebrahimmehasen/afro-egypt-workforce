"use client";

import { FileSpreadsheet } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";

/**
 * "تفاصيل المرتبات": downloads the period's payroll as an Excel sheet from /api/payroll/export, which checks the
 * permission and scope itself. Disabled — with the reason as its tooltip — until the period has been calculated.
 */
export function PayrollExportButton({ periodId, hasRecords }: { periodId: string; hasRecords: boolean }) {
  const t = useT();
  if (!hasRecords) {
    return (
      <Button variant="outline" className="gap-2" disabled title={t.payroll.export.noRecords} aria-label={`${t.payroll.export.button} — ${t.payroll.export.noRecords}`}>
        <FileSpreadsheet className="h-4 w-4" />
        {t.payroll.export.button}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" className="gap-2">
      <a href={`/api/payroll/export?period=${encodeURIComponent(periodId)}`} download>
        <FileSpreadsheet className="h-4 w-4" />
        {t.payroll.export.button}
      </a>
    </Button>
  );
}
