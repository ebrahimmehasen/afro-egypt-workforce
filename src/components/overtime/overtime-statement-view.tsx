"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Search, TimerReset } from "lucide-react";
import { formatEGP } from "@/lib/constants";
import { format } from "@/lib/i18n/format";
import {
  STATEMENT_KINDS,
  defaultStatementRange,
  hoursLabel,
  statementKindLabel,
  type OvertimeStatement,
} from "@/lib/overtime-statement";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelectFilter, type MultiSelectOption } from "@/components/shared/multi-select-filter";
import { EmptyState } from "@/components/shared/empty-state";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The period picker, the statement table and its export. The period is applied through the URL, so the server
 * builds the statement (scope and permission included); the name / department filters only narrow what is shown.
 * `statement` is null when "from" is after "to".
 */
export function OvertimeStatementView({
  statement,
  year,
  month,
  from,
  to,
  departments,
}: {
  statement: OvertimeStatement | null;
  year: number;
  month: number;
  from: string;
  to: string;
  departments: MultiSelectOption[];
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [monthValue, setMonthValue] = useState(`${year}-${pad(month)}`);
  const [fromValue, setFromValue] = useState(from);
  const [toValue, setToValue] = useState(to);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string[]>([]);

  // a new month brings its own default dates (21st → 20th); they stay editable
  const changeMonth = (value: string) => {
    setMonthValue(value);
    const m = /^(\d{4})-(\d{2})$/.exec(value);
    if (!m) return;
    const range = defaultStatementRange(Number(m[1]), Number(m[2]));
    setFromValue(range.from);
    setToValue(range.to);
  };
  const query = (q: { month: string; from: string; to: string }) => new URLSearchParams(q).toString();
  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(`/overtime/statement?${query({ month: monthValue, from: fromValue, to: toValue })}`);
  };

  const lines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (statement?.lines ?? []).filter(
      (l) =>
        (!q || l.name.toLowerCase().includes(q) || l.employeeNumber.toLowerCase().includes(q)) &&
        (deptFilter.length === 0 || deptFilter.includes(l.departmentId)),
    );
  }, [statement, search, deptFilter]);
  const total = useMemo(
    () => ({
      hours: Math.round(lines.reduce((s, l) => s + l.hours, 0) * 100) / 100,
      amount: lines.reduce((s, l) => s + l.amount, 0),
      byKind: Object.fromEntries(STATEMENT_KINDS.map((k) => [k, lines.reduce((s, l) => s + l.byKind[k], 0)])) as Record<(typeof STATEMENT_KINDS)[number], number>,
    }),
    [lines],
  );

  const hasData = Boolean(statement && statement.lines.length > 0);
  const exportHref = `/api/overtime/statement/export?${query({ month: `${year}-${pad(month)}`, from, to })}`;

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={apply} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="st-month" className="text-xs">{t.overtime.statement.month}</Label>
          <Input id="st-month" type="month" value={monthValue} onChange={(e) => changeMonth(e.target.value)} className="sm:w-44" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="st-from" className="text-xs">{t.overtime.statement.from}</Label>
          <Input id="st-from" type="date" value={fromValue} onChange={(e) => setFromValue(e.target.value)} className="sm:w-44" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="st-to" className="text-xs">{t.overtime.statement.to}</Label>
          <Input id="st-to" type="date" value={toValue} onChange={(e) => setToValue(e.target.value)} className="sm:w-44" />
        </div>
        <Button type="submit">{t.overtime.statement.apply}</Button>
        <div className="sm:ms-auto">
          {hasData ? (
            <Button asChild variant="outline" className="gap-2">
              <a href={exportHref} download>
                <FileSpreadsheet className="h-4 w-4" />
                {t.overtime.statement.export}
              </a>
            </Button>
          ) : (
            <Button variant="outline" className="gap-2" disabled title={t.overtime.statement.noData}>
              <FileSpreadsheet className="h-4 w-4" />
              {t.overtime.statement.export}
            </Button>
          )}
        </div>
      </form>

      {!statement ? (
        <p className="text-sm text-destructive">{t.overtime.statement.invalidRange}</p>
      ) : (
        <>
          {statement.pendingCount > 0 && (
            <p className="text-xs text-muted-foreground">{format(t.overtime.statement.pendingNotice, { count: statement.pendingCount })}</p>
          )}

          {statement.lines.length === 0 ? (
            <EmptyState icon={TimerReset} title={t.overtime.statement.empty} />
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder={t.employees.searchPlaceholder} className="ps-9" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <MultiSelectFilter className="sm:w-48" placeholder={t.common.allDepartments} selected={deptFilter} onChange={setDeptFilter} options={departments} />
              </div>

              {/* w-0 + min-w-full: the wide table scrolls inside this box instead of widening the whole page */}
              <div className="w-0 min-w-full overflow-x-auto rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.payslip.employeeId}</TableHead>
                      <TableHead>{t.payslip.employeeName}</TableHead>
                      <TableHead>{t.payslip.department}</TableHead>
                      <TableHead>{t.overtime.statement.colHours}</TableHead>
                      <TableHead>{t.overtime.statement.colAmount}</TableHead>
                      {STATEMENT_KINDS.map((k) => (
                        <TableHead key={k}>{statementKindLabel(k, t)}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l) => (
                      <TableRow key={l.employeeId} className={l.terminated ? "text-muted-foreground" : undefined}>
                        <TableCell dir="ltr" className="text-start font-mono text-xs">{l.employeeNumber}</TableCell>
                        <TableCell className="font-medium">{l.name}</TableCell>
                        <TableCell>{l.department}</TableCell>
                        <TableCell dir="ltr" className="text-start tabular-nums">{hoursLabel(l.hours)}</TableCell>
                        <TableCell className="tabular-nums font-semibold">{formatEGP(l.amount, locale)}</TableCell>
                        {STATEMENT_KINDS.map((k) => (
                          <TableCell key={k} className="tabular-nums">{formatEGP(l.byKind[k], locale)}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="font-bold">
                      <TableCell colSpan={3}>{t.overtime.statement.total}</TableCell>
                      <TableCell dir="ltr" className="text-start tabular-nums">{hoursLabel(total.hours)}</TableCell>
                      <TableCell className="tabular-nums">{formatEGP(total.amount, locale)}</TableCell>
                      {STATEMENT_KINDS.map((k) => (
                        <TableCell key={k} className="tabular-nums">{formatEGP(total.byKind[k], locale)}</TableCell>
                      ))}
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
