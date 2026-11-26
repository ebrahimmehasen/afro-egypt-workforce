import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { getT } from "@/lib/i18n";
import { APP_TIME_ZONE, intlLocale } from "@/lib/i18n/format";
import { Badge } from "@/components/ui/badge";

type Cases = {
  id: string;
  createdAt: Date;
  createdByName: string;
  finalText: string | null;
  aiGenerated: boolean;
  /** Everyone the case is attached to (that the viewer may see): more than one means a group case. */
  employees?: { id: string; name: string }[];
}[];

/**
 * The saved case proofs of one employee, shown on his profile to the admin and the supervisors of his department only (the
 * page decides who gets this tab). A reference for judging efficiency; it changes nothing about attendance or pay.
 */
export function EmployeeCases({ cases, t, locale }: { cases: Cases; t: Awaited<ReturnType<typeof getT>>; locale: "ar" | "en" }) {
  const c = t.caseProof;
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone: APP_TIME_ZONE });
  return (
    <div className="flex flex-col gap-3" data-testid="employee-cases">
      <p className="text-sm text-muted-foreground">{c.noEffect}</p>
      {cases.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">{c.profileEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cases.map((row) => (
            <li key={row.id} className="flex items-start gap-3 rounded-lg border bg-card p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/case-proof/${row.id}/photo`} alt={c.photoAlt} className="h-16 w-16 shrink-0 rounded-md border object-cover" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{dateFmt.format(row.createdAt)}</span>
                  <span>{row.createdByName}</span>
                  {row.aiGenerated && <Badge variant="outline" className="gap-1"><Sparkles className="h-3 w-3" />{c.aiBadgeSaved}</Badge>}
                </div>
                {row.employees && row.employees.length > 1 && (
                  <p className="text-xs text-muted-foreground" data-testid="group-members">{c.forEmployees} {row.employees.map((e) => e.name).join("، ")}</p>
                )}
                <p className="line-clamp-3 whitespace-pre-wrap text-sm">{row.finalText ?? c.noText}</p>
                <Link href={`/case-proof/${row.id}`} className="w-fit text-xs text-primary hover:underline">{c.view}</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
