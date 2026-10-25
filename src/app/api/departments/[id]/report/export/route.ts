import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { viewerScope } from "@/lib/scope";
import { getDb } from "@/lib/data";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { localDay } from "@/lib/today";
import { departmentReport, parseReportRange } from "@/lib/department-report";
import { buildDepartmentReportWorkbook, departmentReportFileName } from "@/lib/department-report-export";

/**
 * GET /api/departments/:id/report/export?range=week|current|previous — the department report as a workbook.
 *
 * /api skips the middleware, so every check is here: a session (401), the "departments" permission (403), and
 * the department existing, not removed, and inside the account's departments (404). The numbers come from the
 * same read model as the page (departmentReport), for the same scope and period, so file and screen agree; a
 * section's sheet is in the file only for who may see that section. Read only. No file when the department has
 * no employees within the viewer's scope.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  const t = await getT();
  if (!user) return NextResponse.json({ error: t.validation.sessionExpired }, { status: 401 });
  if (!hasPermission(user, "departments")) return NextResponse.json({ error: t.validation.notAllowed }, { status: 403 });

  const { id } = await params;
  const range = parseReportRange(req.nextUrl.searchParams.get("range"));
  const [db, locale] = await Promise.all([getDb(), getLocale()]);
  const report = await departmentReport(viewerScope(user, db.employees), user, id, range, locale, { db });
  if (!report) return NextResponse.json({ error: t.validation.notFound }, { status: 404 });
  if (report.employees.length === 0) return NextResponse.json({ error: t.departmentReport.noData }, { status: 404 });

  const now = new Date();
  const exportedAt = `${localDay(now)} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const book = buildDepartmentReportWorkbook(report, locale, { exportedBy: user.name, exportedAt });
  const buffer: Buffer = XLSX.write(book, { bookType: "xlsx", type: "buffer" });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${departmentReportFileName(report)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
