import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAccess } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { currentYearMonth } from "@/lib/today";
import { overtimeStatementFileName, overtimeStatementSheet, statementParams } from "@/lib/overtime-statement";
import { loadOvertimeStatement } from "@/lib/overtime-statement-data";

/**
 * GET /api/overtime/statement/export?month=yyyy-MM&from=yyyy-MM-dd&to=yyyy-MM-dd — the "كشف الإضافي" workbook.
 * Same check as the page (the "overtime" permission) and the same scope, enforced here and not only by hiding
 * the button. Read only. No file when there is nothing approved in the period.
 */
export async function GET(req: NextRequest) {
  const user = await requireAccess("/overtime/statement");
  const t = await getT();
  if (!hasPermission(user, "overtime")) return NextResponse.json({ error: t.validation.notAllowed }, { status: 403 });

  const q = req.nextUrl.searchParams;
  const { year, month, from, to, invalidRange } = statementParams({ month: q.get("month"), from: q.get("from"), to: q.get("to") }, currentYearMonth());
  if (invalidRange) return NextResponse.json({ error: t.overtime.statement.invalidRange }, { status: 400 });

  const locale = await getLocale();
  const statement = await loadOvertimeStatement(user, from, to, locale);
  if (statement.lines.length === 0) return NextResponse.json({ error: t.overtime.statement.noData }, { status: 404 });

  // same shape as the /reports export: one sheet, header row first, column widths from the content
  const { headers, rows } = overtimeStatementSheet(statement, t);
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet["!cols"] = headers.map((h, i) => ({ wch: Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)) + 2 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, t.overtime.statement.sheetName);
  book.Workbook = { Views: [{ RTL: locale === "ar" }] };
  const buffer: Buffer = XLSX.write(book, { bookType: "xlsx", type: "buffer" });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${overtimeStatementFileName(year, month)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
