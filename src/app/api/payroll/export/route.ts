import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { requireAccess } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { inScope, viewerScope } from "@/lib/scope";
import { getDb } from "@/lib/data";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { loadPayContext, rulesFor } from "@/lib/pay-context";
import { payMonthRange } from "@/lib/payroll-recalc";
import { payrollExportFileName, payrollExportSheet } from "@/lib/payroll-export";

/**
 * GET /api/payroll/export?period=<id> — the "تفاصيل المرتبات" workbook of one payroll period.
 *
 * Who: the same page check as /payroll (requireAccess), and on top of it the "payroll" permission — the
 * self-service accounts that may open /payroll to see their own payslip may not export the company's payroll.
 * What: only the employees inside the viewer's scope (a department supervisor gets their department).
 * Read only: nothing is written and nothing is recalculated — the amounts are the stored payroll records.
 */
export async function GET(req: NextRequest) {
  const user = await requireAccess("/payroll");
  const t = await getT();
  if (!hasPermission(user, "payroll")) return NextResponse.json({ error: t.validation.notAllowed }, { status: 403 });

  const periodId = req.nextUrl.searchParams.get("period") ?? "";
  const db = await getDb();
  const period = db.payrollPeriods.find((p) => p.id === periodId);
  if (!period) return NextResponse.json({ error: t.validation.periodNotFound }, { status: 404 });

  const scope = viewerScope(user, db.employees);
  const records = db.payrollRecords.filter((r) => r.periodId === period.id && inScope(scope, r.employeeId));
  if (records.length === 0) return NextResponse.json({ error: t.payroll.export.noRecords }, { status: 404 });

  const [ctx, locale] = await Promise.all([loadPayContext(), getLocale()]);
  const { from, to } = payMonthRange(period.year, period.month, ctx.payPeriodStartDay);
  const deductions = await prisma.deduction.findMany({
    where: { employeeId: { in: records.map((r) => r.employeeId) }, date: { gte: from, lt: to }, voidedAt: null },
    select: { employeeId: true, type: true, amount: true },
  });

  const { headers, rows } = payrollExportSheet({
    records,
    employees: db.employees,
    departments: db.departments,
    deductions,
    payTypeOf: (e) => rulesFor(ctx, { payTypeId: e.payTypeId ?? null, salaryType: e.salaryType }).name,
    t,
    locale,
  });

  // same shape as the /reports export: one sheet, header row first, column widths from the content
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet["!cols"] = headers.map((h, i) => ({ wch: Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)) + 2 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, t.payroll.export.sheetName);
  book.Workbook = { Views: [{ RTL: locale === "ar" }] };
  const buffer: Buffer = XLSX.write(book, { bookType: "xlsx", type: "buffer" });

  const filename = payrollExportFileName(period.year, period.month);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
