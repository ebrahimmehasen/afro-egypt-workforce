import Link from "next/link";
import { redirect } from "next/navigation";
import { Paperclip } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAccess } from "@/lib/auth";
import { canManageApplications } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { APP_TIME_ZONE, intlLocale } from "@/lib/i18n/format";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { APPLICATION_STATUSES } from "@/lib/recruitment/config";

const selectCls = "h-9 rounded-md border border-input bg-background px-3 text-sm";
const statusVariant = { new: "gold", reviewed: "secondary", shortlisted: "default", rejected: "destructive", hired: "success" } as const;

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ job?: string; status?: string }> }) {
  const user = await requireAccess("/employees");
  // admin, or HR with the employees grant: a supervisor or department head never sees applicants
  if (!canManageApplications(user)) redirect("/employees");
  const t = await getT();
  const locale = await getLocale();
  const r = t.recruitment.admin;
  const { job, status } = await searchParams;
  const statusFilter = (APPLICATION_STATUSES as readonly string[]).includes(status ?? "") ? (status as (typeof APPLICATION_STATUSES)[number]) : undefined;

  const [jobs, applications] = await Promise.all([
    prisma.jobOpening.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.jobApplication.findMany({
      where: { ...(job ? { jobOpeningId: job } : {}), ...(statusFilter ? { status: statusFilter } : {}) },
      include: { jobOpening: true, _count: { select: { documents: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);
  const newCount = await prisma.jobApplication.count({ where: { status: "new" } });
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: APP_TIME_ZONE });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={r.title}
        description={`${r.subtitle}${newCount > 0 ? ` — ${r.newCount.replace("{count}", String(newCount))}` : ""}`}
        actions={
          <>
            <Button asChild variant="outline"><Link href="/employees/jobs">{r.jobsButton}</Link></Button>
            <Button asChild variant="outline"><Link href="/employees/applications/form">{r.formButton}</Link></Button>
            <Button asChild variant="ghost"><Link href="/employees">{t.nav.employees}</Link></Button>
          </>
        }
      />

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {r.filterJob}
          <select name="job" defaultValue={job ?? ""} className={selectCls}>
            <option value="">{r.all}</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {r.filterStatus}
          <select name="status" defaultValue={statusFilter ?? ""} className={selectCls}>
            <option value="">{r.all}</option>
            {APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{r.statuses[s]}</option>)}
          </select>
        </label>
        <Button type="submit" size="sm">{t.common.search}</Button>
      </form>

      {applications.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">{r.empty}</p>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{r.applicant}</TableHead>
                <TableHead>{r.job}</TableHead>
                <TableHead>{r.phone}</TableHead>
                <TableHead>{r.status}</TableHead>
                <TableHead>{r.submitted}</TableHead>
                <TableHead>{r.files}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium"><Link className="hover:underline" href={`/employees/applications/${a.id}`}>{a.fullName}</Link></TableCell>
                  <TableCell>{a.jobOpening.title}</TableCell>
                  <TableCell dir="ltr" className="text-end">{a.phone}</TableCell>
                  <TableCell><Badge variant={statusVariant[a.status]}>{r.statuses[a.status]}</Badge></TableCell>
                  <TableCell>{dateFmt.format(a.createdAt)}</TableCell>
                  <TableCell>{a._count.documents > 0 && <span className="inline-flex items-center gap-1 text-xs"><Paperclip className="h-3.5 w-3.5" />{a._count.documents}</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
