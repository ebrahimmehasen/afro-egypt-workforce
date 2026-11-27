import { requireAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getT } from "@/lib/i18n";
import { loadEvaluationRows } from "@/lib/evaluation/data";
import { PageHeader } from "@/components/shared/page-header";
import { EvaluationTable } from "@/components/evaluation/evaluation-table";

/**
 * /evaluation — admin only (see ADMIN_NAV in src/lib/permissions.ts: never a grantable permission, so HR, a
 * supervisor or an employee redirect to /dashboard the same way they would for /users or /permissions). A read-only
 * list with zero effect on payroll, deductions, lateness or attendance calculation.
 */
export default async function EvaluationPage() {
  await requireAccess("/evaluation");
  const t = await getT();
  const [rows, departments] = await Promise.all([loadEvaluationRows(), prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t.evaluation.title} description={t.evaluation.subtitle} />
      <p className="rounded-lg border-2 border-warning/60 bg-warning/10 px-3 py-2 text-sm font-medium" data-testid="evaluation-no-effect">{t.evaluation.noEffect}</p>
      <EvaluationTable rows={rows} departments={departments} />
    </div>
  );
}
