import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { requireAccess } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { APP_TIME_ZONE, intlLocale } from "@/lib/i18n/format";
import { loadEmployeeEvaluationDetail, loadJobLevels, loadRatingScale } from "@/lib/evaluation/data";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentLinkList } from "@/components/evaluation/document-link-list";
import { SetJobLevelDialog } from "@/components/evaluation/set-job-level-dialog";
import { AddReviewDialog } from "@/components/evaluation/add-review-dialog";
import { CASE_PROOF_SEVERITY_BADGE } from "@/lib/case-proof/config";

export default async function EvaluationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAccess("/evaluation");
  const t = await getT();
  const e = t.evaluation;
  const locale = await getLocale();
  const { id } = await params;

  const [detail, levels, scale] = await Promise.all([loadEmployeeEvaluationDetail(id), loadJobLevels(), loadRatingScale()]);
  if (!detail) notFound();

  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone: APP_TIME_ZONE });
  const dateTimeFmt = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: APP_TIME_ZONE });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={detail.employee.name}
        description={`${detail.employee.employeeNumber} — ${detail.employee.departmentName}`}
        actions={<Button asChild variant="outline"><Link href="/evaluation"><ArrowRight className="h-4 w-4" />{e.back}</Link></Button>}
      />
      <p className="rounded-lg border-2 border-warning/60 bg-warning/10 px-3 py-2 text-sm font-medium" data-testid="evaluation-detail-no-effect">{e.noEffect}</p>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{e.detail.profileTitle}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-1.5 text-sm">
            <p><span className="text-muted-foreground">{t.common.jobTitle}: </span>{detail.employee.jobTitle}</p>
            <p><span className="text-muted-foreground">{t.employees.formHireDate}: </span>{dateFmt.format(detail.employee.hireDate)}</p>
            {detail.employee.phone && <p dir="ltr" className="text-start"><span className="text-muted-foreground">{t.employees.formPhone}: </span>{detail.employee.phone}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle>{e.detail.jobLevelTitle}</CardTitle>
            <SetJobLevelDialog employeeId={id} levels={levels} />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-lg font-semibold">{detail.currentJobLevel ? detail.currentJobLevel.name : <span className="text-sm font-normal text-muted-foreground">{e.notSet}</span>}</p>
            <div>
              <p className="mb-1 text-sm font-medium text-muted-foreground">{e.detail.levelHistoryTitle}</p>
              {detail.levelHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">{e.detail.noLevelHistory}</p>
              ) : (
                <ul className="flex flex-col gap-2" data-testid="level-history">
                  {detail.levelHistory.map((h) => (
                    <li key={h.id} className="rounded-md border border-border px-3 py-2 text-sm">
                      <p className="font-medium">{h.jobLevelName}</p>
                      <p className="text-muted-foreground">{h.reason}</p>
                      <p className="text-xs text-muted-foreground">{e.detail.byLine} {h.changedByName} — {dateTimeFmt.format(h.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{e.detail.certificatesTitle}</CardTitle></CardHeader>
          <CardContent>
            {detail.certificates.length === 0 ? <p className="text-sm text-muted-foreground">{e.detail.noCertificates}</p> : <DocumentLinkList documents={detail.certificates} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{e.detail.previousExperienceTitle}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {detail.previousExperience.documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">{e.detail.noExperienceDocuments}</p>
            ) : (
              <DocumentLinkList documents={detail.previousExperience.documents} />
            )}
            <div>
              <p className="mb-1 text-sm font-medium text-muted-foreground">{e.detail.experienceTextLabel}</p>
              <p className="whitespace-pre-wrap text-sm">{detail.previousExperience.applicationText ?? e.detail.noExperienceText}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle>{e.detail.evaluationsTitle}</CardTitle>
            <AddReviewDialog employeeId={id} scale={scale} />
          </CardHeader>
          <CardContent>
            {detail.evaluations.length === 0 ? (
              <p className="text-sm text-muted-foreground">{e.detail.noEvaluations}</p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="evaluations-list">
                {detail.evaluations.map((r) => (
                  <li key={r.id} className="rounded-md border border-border px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2 font-medium">
                      {r.periodLabel}
                      <Badge variant="outline">{r.ratingLabel}</Badge>
                    </div>
                    {r.comment && <p className="text-muted-foreground">{r.comment}</p>}
                    <p className="text-xs text-muted-foreground">{e.detail.byLine} {r.createdByName} — {dateFmt.format(r.periodDate)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{e.detail.caseHistoryTitle}</CardTitle></CardHeader>
          <CardContent>
            {detail.caseHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">{e.detail.noCases}</p>
            ) : (
              <ul className="flex flex-col gap-3" data-testid="case-history">
                {detail.caseHistory.map((c) => (
                  <li key={c.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">{dateFmt.format(c.createdAt)}</span>
                      {c.severity ? (
                        <Badge variant={CASE_PROOF_SEVERITY_BADGE[c.severity]}>{t.caseProof.severities[c.severity]}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">{e.notSet}</span>
                      )}
                      {c.estimatedLossPercent != null && <span className="text-xs text-muted-foreground">{e.detail.estimatedLoss}: {c.estimatedLossPercent}%</span>}
                    </div>
                    <p className="whitespace-pre-wrap">{c.text ?? t.caseProof.noText}</p>
                    <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-6" data-testid="case-photos">
                      {c.photoUrls.map((url) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={url} src={url} alt={t.caseProof.photoAlt} className="aspect-square w-full rounded border object-cover" />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
