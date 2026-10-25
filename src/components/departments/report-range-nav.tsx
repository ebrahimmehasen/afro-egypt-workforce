"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers/locale-provider";
import { REPORT_RANGES, type ReportRange } from "@/lib/department-report-range";

/** The report's period: last 7 days, this pay month or the one before — kept in the URL as ?range=. */
export function ReportRangeNav({ departmentId, range }: { departmentId: string; range: ReportRange }) {
  const t = useT();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const labels: Record<ReportRange, string> = {
    week: t.departmentReport.rangeWeek,
    current: t.departmentReport.rangeCurrent,
    previous: t.departmentReport.rangePrevious,
  };

  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t.departmentReport.rangeLabel} aria-busy={isPending}>
      {REPORT_RANGES.map((r) => (
        <Button
          key={r}
          size="sm"
          variant={r === range ? "default" : "outline"}
          disabled={isPending}
          aria-pressed={r === range}
          onClick={() => startTransition(() => router.push(`/departments/${encodeURIComponent(departmentId)}?range=${r}`))}
        >
          {labels[r]}
        </Button>
      ))}
    </div>
  );
}
