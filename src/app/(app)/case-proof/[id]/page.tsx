import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { requireAccess } from "@/lib/auth";
import { canUseCaseProof } from "@/lib/case-proof/audience";
import { canEditCaseProof, loadCaseProof } from "@/lib/case-proof/data";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { APP_TIME_ZONE, intlLocale } from "@/lib/i18n/format";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CaseTextForm } from "@/components/case-proof/case-proof-flow";

export default async function CaseProofDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAccess("/case-proof");
  if (!canUseCaseProof(user)) redirect("/dashboard");
  const t = await getT();
  const locale = await getLocale();
  const c = t.caseProof;
  const { id } = await params;
  // a case outside the viewer's departments is "not found", the same as one that does not exist
  const row = await loadCaseProof(user, id);
  if (!row) notFound();
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: APP_TIME_ZONE });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`${c.title} — ${row.employee.name}`}
        description={`${row.employee.department.name} — ${row.createdByName} — ${dateFmt.format(row.createdAt)}`}
        actions={<Button asChild variant="outline"><Link href="/case-proof">{c.back}</Link></Button>}
      />
      <div className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/case-proof/${row.id}/photo`} alt={c.photoAlt} className="max-h-96 w-full rounded-lg border object-contain" />
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant={row.status === "saved" ? "success" : "gold"}>{c.statuses[row.status]}</Badge>
            {row.aiGenerated && <Badge variant="outline" className="gap-1"><Sparkles className="h-3 w-3" />{c.aiBadgeSaved}</Badge>}
          </div>
          {canEditCaseProof(user, row.createdById) ? (
            <CaseTextForm id={row.id} initial={row.finalText ?? row.aiDraft ?? ""} aiGenerated={row.status === "draft" && row.aiGenerated} />
          ) : (
            <p className="whitespace-pre-wrap text-sm">{row.finalText ?? c.noText}</p>
          )}
        </div>
      </div>
    </div>
  );
}
