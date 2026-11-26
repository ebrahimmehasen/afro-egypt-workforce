import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth";
import { canUseCaseProof } from "@/lib/case-proof/audience";
import { loadEmployeeCaseProofTab } from "@/lib/case-proof/data";
import { prisma } from "@/lib/prisma";
import { format } from "@/lib/i18n/format";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { EmployeeCases } from "@/components/case-proof/employee-cases";

/**
 * One employee's saved cases, under the case-proof pages. The employee profile (/employees/[number]) needs the "employees" page
 * permission, which a department supervisor may not have; this page is how an admin or a department supervisor reaches the same
 * list from the case-proof area. Keyed by the employee's database id; the same rule decides who sees it (the admin, and a
 * supervisor of the employee's department): for everyone else the page does not exist.
 */
export default async function EmployeeCaseProofPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("/case-proof");
  if (!canUseCaseProof(user)) redirect("/dashboard");
  const t = await getT();
  const locale = await getLocale();
  const { id } = await params;
  const employee = await prisma.employee.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true, departmentId: true } });
  if (!employee) notFound();
  const tab = await loadEmployeeCaseProofTab(user, employee);
  if (!tab.show) notFound();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={format(t.caseProof.employeeCasesTitle, { name: employee.name })}
        actions={<Button asChild variant="outline"><Link href="/case-proof">{t.caseProof.back}</Link></Button>}
      />
      <EmployeeCases cases={tab.cases} t={t} locale={locale} />
    </div>
  );
}
