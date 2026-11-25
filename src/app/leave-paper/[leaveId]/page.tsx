import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/data";
import { getSession } from "@/lib/auth";
import { viewerScope } from "@/lib/scope";
import { getT } from "@/lib/i18n";
import { canViewLeavePaper, leavePaperDays } from "@/lib/leave-paper";
import { loadDayKindRule } from "@/lib/leave-days";
import { LeavePaper } from "@/components/leaves/leave-paper";

/** The browser prints the page title at the top of the sheet, so the paper carries a neutral one of its own
 * instead of the app's (which names the company). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.leavePaper.title };
}

/**
 * A printable leave paper for one leave request, on a plain sheet headed by the company's logo and name (from the company settings). Who may
 * open it is who can see that leave in the leaves list: an account that can open the leaves page, for an employee in
 * its scope (a self-service employee: their own). Anyone else gets "not found", as for a payslip. It only shows the
 * request's existing status — a pending or rejected request is marked "not approved" on the page and when printed.
 */
export default async function LeavePaperPage({ params }: { params: Promise<{ leaveId: string }> }) {
  const user = await getSession();
  if (!user) redirect("/login");

  const db = await getDb();
  const t = await getT();
  const { leaveId } = await params;
  const leave = db.leaves.find((l) => l.id === leaveId);
  if (!leave) notFound();
  if (!canViewLeavePaper(user, leave.employeeId, viewerScope(user, db.employees))) notFound();

  const employee = db.employees.find((e) => e.id === leave.employeeId);
  if (!employee) notFound();

  const days = leavePaperDays(leave, await loadDayKindRule());
  return <LeavePaper t={t} leave={leave} employee={{ name: employee.name, employeeNumber: employee.employeeNumber }} days={days} company={{ name: db.companySettings.companyName, logoUrl: db.companySettings.logoUrl }} />;
}
