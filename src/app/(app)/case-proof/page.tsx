import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/auth";
import { canUseCaseProof } from "@/lib/case-proof/audience";
import { employeesForCaseProof } from "@/lib/case-proof/access";
import { loadCaseProofs } from "@/lib/case-proof/data";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { APP_TIME_ZONE, intlLocale } from "@/lib/i18n/format";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CaseProofFlow } from "@/components/case-proof/case-proof-flow";

export default async function CaseProofPage() {
  const user = await requireAccess("/case-proof");
  // the admin, or a department supervisor with departments on his account: nobody else (HR included)
  if (!canUseCaseProof(user)) redirect("/dashboard");
  const t = await getT();
  const locale = await getLocale();
  const c = t.caseProof;
  const [employees, cases] = await Promise.all([employeesForCaseProof(user), loadCaseProofs(user)]);
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: APP_TIME_ZONE });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={c.title} description={c.subtitle} />
      <p className="rounded-lg border-2 border-warning/60 bg-warning/10 px-3 py-2 text-sm font-medium" data-testid="case-proof-no-effect">{c.noEffect}</p>
      <CaseProofFlow employees={employees.map((e) => ({ id: e.id, name: e.name, employeeNumber: e.employeeNumber }))} />

      <h2 className="mt-2 font-semibold">{c.list}</h2>
      {cases.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">{c.emptyList}</p>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{c.columns.employee}</TableHead>
                <TableHead>{c.columns.department}</TableHead>
                <TableHead>{c.columns.by}</TableHead>
                <TableHead>{c.columns.date}</TableHead>
                <TableHead>{c.columns.status}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium"><Link className="hover:underline" href={`/case-proof/${row.id}`}>{row.employees.map((e) => e.name).join("، ")}</Link></TableCell>
                  <TableCell>{[...new Set(row.employees.map((e) => e.departmentName))].join("، ")}</TableCell>
                  <TableCell>{row.createdByName}</TableCell>
                  <TableCell>{dateFmt.format(row.createdAt)}</TableCell>
                  <TableCell><Badge variant={row.status === "saved" ? "success" : "gold"}>{c.statuses[row.status]}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
