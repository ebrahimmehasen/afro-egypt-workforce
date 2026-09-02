"use client";

import { FileSpreadsheet, FileText, Printer } from "lucide-react";
import { exportCSV, exportExcel, ExportRow } from "@/lib/export";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";

export function ExportButtons({
  filename,
  headers,
  rows,
}: {
  filename: string;
  headers: string[];
  rows: ExportRow[];
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2 no-print">
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportExcel(filename, headers, rows)}>
        <FileSpreadsheet className="h-4 w-4" />
        {t.common.exportExcel}
      </Button>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => exportCSV(filename, headers, rows)}>
        <FileText className="h-4 w-4" />
        {t.common.exportCsv}
      </Button>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}>
        <Printer className="h-4 w-4" />
        {t.common.print}
      </Button>
    </div>
  );
}
