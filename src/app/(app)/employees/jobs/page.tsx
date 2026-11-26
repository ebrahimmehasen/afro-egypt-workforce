import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAccess } from "@/lib/auth";
import { canManageApplications } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { format } from "@/lib/i18n/format";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { JobDialog } from "@/components/recruitment/job-dialog";

export default async function JobsPage() {
  const user = await requireAccess("/employees");
  if (!canManageApplications(user)) redirect("/employees");
  const t = await getT();
  const r = t.recruitment.admin;
  const jobs = await prisma.jobOpening.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { _count: { select: { applications: true } } } });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={r.jobs.title}
        description={r.jobs.intro}
        actions={
          <>
            <JobDialog />
            <Button asChild variant="outline"><Link href="/employees/applications">{r.back}</Link></Button>
          </>
        }
      />
      {jobs.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">{r.jobs.none}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {jobs.map((j) => (
            <div key={j.id} className="flex flex-col gap-2 rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{j.title}</h3>
                <Badge variant={j.open ? "success" : "secondary"}>{j.open ? r.jobs.openBadge : r.jobs.closedBadge}</Badge>
              </div>
              {j.description && <p className="text-sm text-muted-foreground">{j.description}</p>}
              <p className="text-xs text-muted-foreground">
                {j.salaryMin !== null || j.salaryMax !== null ? `${j.salaryMin ?? "—"} – ${j.salaryMax ?? "—"}` : "—"}
                {j.showSalary ? ` (${r.jobs.showSalary})` : ""}
              </p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{format(r.jobs.applicants, { count: j._count.applications })}</span>
                <JobDialog job={{ id: j.id, title: j.title, description: j.description ?? "", open: j.open, salaryMin: j.salaryMin, salaryMax: j.salaryMax, showSalary: j.showSalary, sortOrder: j.sortOrder }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
