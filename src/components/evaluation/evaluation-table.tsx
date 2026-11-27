"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/providers/locale-provider";
import { MultiSelectFilter } from "@/components/shared/multi-select-filter";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users } from "lucide-react";
import type { EvaluationListRow } from "@/lib/evaluation/data";
import { CASE_PROOF_SEVERITY_BADGE } from "@/lib/case-proof/config";

export interface EvaluationTableRow extends EvaluationListRow {}

/**
 * The employee-evaluation list: department / job-level / rating filters, each employee's current job level,
 * latest performance rating, case-proof count and a severity summary. No combined score and no ranking — rows
 * stay in name order regardless of any filter chosen.
 */
export function EvaluationTable({
  rows,
  departments,
}: {
  rows: EvaluationTableRow[];
  departments: { id: string; name: string }[];
}) {
  const t = useT();
  const e = t.evaluation;
  const sev = t.caseProof.severities;
  const [dept, setDept] = useState<string[]>([]);
  const [level, setLevel] = useState<string[]>([]);
  const [rating, setRating] = useState<string[]>([]);

  const levelOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (r.jobLevel) seen.set(r.jobLevel.id, r.jobLevel.name);
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [rows]);
  const ratingOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (r.latestRating) seen.set(r.latestRating.id, r.latestRating.label);
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [rows]);

  const filtered = rows.filter(
    (r) =>
      (dept.length === 0 || dept.includes(r.departmentId)) &&
      (level.length === 0 || (r.jobLevel && level.includes(r.jobLevel.id))) &&
      (rating.length === 0 || (r.latestRating && rating.includes(r.latestRating.id))),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <MultiSelectFilter className="sm:w-48" placeholder={e.filters.allDepartments} selected={dept} onChange={setDept} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
        <MultiSelectFilter className="sm:w-48" placeholder={e.filters.allLevels} selected={level} onChange={setLevel} options={levelOptions} />
        <MultiSelectFilter className="sm:w-48" placeholder={e.filters.allRatings} selected={rating} onChange={setRating} options={ratingOptions} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title={e.emptyList} description="" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{e.columns.employee}</TableHead>
                <TableHead>{e.columns.department}</TableHead>
                <TableHead>{e.columns.jobLevel}</TableHead>
                <TableHead>{e.columns.latestRating}</TableHead>
                <TableHead>{e.columns.caseCount}</TableHead>
                <TableHead>{e.columns.severity}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.employeeId}>
                  <TableCell className="font-medium">
                    <Link className="hover:underline" href={`/evaluation/${r.employeeId}`}>{r.name}</Link>
                    <div dir="ltr" className="text-xs text-muted-foreground">{r.employeeNumber}</div>
                  </TableCell>
                  <TableCell>{r.departmentName}</TableCell>
                  <TableCell>{r.jobLevel ? r.jobLevel.name : <span className="text-muted-foreground">{e.notSet}</span>}</TableCell>
                  <TableCell>{r.latestRating ? r.latestRating.label : <span className="text-muted-foreground">{e.notSet}</span>}</TableCell>
                  <TableCell className="tabular-nums">{r.caseCount}</TableCell>
                  <TableCell>
                    {r.caseCount === 0 ? (
                      <span className="text-muted-foreground">{e.none}</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1 text-xs">
                        {r.severity.small > 0 && <Badge variant={CASE_PROOF_SEVERITY_BADGE.small}>{sev.small} {r.severity.small}</Badge>}
                        {r.severity.medium > 0 && <Badge variant={CASE_PROOF_SEVERITY_BADGE.medium}>{sev.medium} {r.severity.medium}</Badge>}
                        {r.severity.large > 0 && <Badge variant={CASE_PROOF_SEVERITY_BADGE.large}>{sev.large} {r.severity.large}</Badge>}
                        {r.severity.estimatedLossPercentSum > 0 && <span dir="ltr" className="text-muted-foreground">Σ {r.severity.estimatedLossPercentSum}%</span>}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
