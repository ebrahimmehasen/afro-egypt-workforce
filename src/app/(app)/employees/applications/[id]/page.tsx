import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Download } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireAccess } from "@/lib/auth";
import { canManageApplications } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { APP_TIME_ZONE, intlLocale } from "@/lib/i18n/format";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ApplicationReviewForm } from "@/components/recruitment/application-review-form";
import { loadFormConfig } from "@/lib/recruitment/data";

type Answer = { key: string; labelAr: string; labelEn: string; value: string | number };

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("/employees");
  if (!canManageApplications(user)) redirect("/employees");
  const t = await getT();
  const locale = await getLocale();
  const r = t.recruitment.admin;
  const { id } = await params;

  const application = await prisma.jobApplication.findUnique({ where: { id }, include: { jobOpening: true, documents: { orderBy: { createdAt: "asc" } } } });
  if (!application) notFound();
  const config = await loadFormConfig();
  const labelOf = (key: string) => {
    const f = config.find((x) => x.key === key);
    return f ? (locale === "ar" ? f.labelAr : f.labelEn) : key;
  };
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone: "UTC" }); // a birth date is a calendar day, stored at UTC midnight
  const dateTimeFmt = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: APP_TIME_ZONE });

  // every default field the applicant could have filled, shown with the label HR gave it (a value left empty is not listed)
  const rows: [string, string][] = (
    [
      ["job", application.jobOpening.title],
      ["fullName", application.fullName],
      ["phone", application.phone],
      ["email", application.email],
      ["nationalId", application.nationalId],
      ["birthDate", application.birthDate ? dateFmt.format(application.birthDate) : null],
      ["city", application.city],
      ["education", application.education],
      ["experience", application.experience],
      ["expectedSalary", application.expectedSalary !== null ? new Intl.NumberFormat(intlLocale(locale)).format(application.expectedSalary) : null],
    ] as [string, string | null][]
  ).flatMap(([k, v]) => (v ? [[labelOf(k), v] as [string, string]] : []));
  const answers = Array.isArray(application.answers) ? (application.answers as Answer[]) : [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={application.fullName}
        description={`${application.jobOpening.title} — ${dateTimeFmt.format(application.createdAt)}`}
        actions={<Button asChild variant="outline"><Link href="/employees/applications">{r.back}</Link></Button>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 lg:col-span-2">
          <h2 className="font-semibold">{r.details}</h2>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="whitespace-pre-wrap text-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {answers.length > 0 && (
            <>
              <h2 className="mt-2 font-semibold">{r.answers}</h2>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {answers.map((a) => (
                  <div key={a.key} className="flex flex-col">
                    <dt className="text-xs text-muted-foreground">{locale === "ar" ? a.labelAr : a.labelEn}</dt>
                    <dd className="whitespace-pre-wrap text-sm font-medium">{String(a.value)}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <h2 className="mt-2 font-semibold">{r.documents}</h2>
          {application.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{r.noDocuments}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {application.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{d.fileName}</span>
                    <Badge variant="outline">{d.mimeType.split("/")[1]}</Badge>
                    <span className="text-xs text-muted-foreground">{Math.max(1, Math.round(d.size / 1024))} KB</span>
                  </span>
                  <Button asChild size="sm" variant="outline" className="gap-1.5">
                    <a href={`/api/applications/${application.id}/documents/${d.id}`}><Download className="h-3.5 w-3.5" />{r.download}</a>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <ApplicationReviewForm id={application.id} status={application.status} note={application.note ?? ""} />
      </div>
    </div>
  );
}
