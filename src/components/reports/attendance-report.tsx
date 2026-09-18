"use client";

import { useMemo, useState } from "react";
import { FileBarChart } from "lucide-react";
import { DailyAttendance, Department, Employee } from "@/lib/types";
import { today } from "@/lib/today";
import { attendanceStatusLabel } from "@/lib/i18n/labels";
import { intlLocale } from "@/lib/i18n/format";
import { translateLabel } from "@/lib/i18n/data-labels";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelectFilter } from "@/components/shared/multi-select-filter";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AttendanceStatusBadge } from "@/components/shared/status-badge";
import { ExportButtons } from "@/components/reports/export-buttons";
import { EmptyState } from "@/components/shared/empty-state";
import { format } from "@/lib/i18n/format";
import { AttendanceStatus } from "@/lib/types";

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const STATUS_OPTIONS: AttendanceStatus[] = [
  "present", "late", "absent", "leave", "mission", "excused_absence", "early_leave", "missing_punch",
];

/** Combined filter values beyond a single literal AttendanceStatus, e.g. from a dashboard KPI link. */
const STATUS_FILTER_GROUPS: Record<string, AttendanceStatus[]> = {
  absent_late: ["absent", "late"],
};

function matchesReportStatus(recordStatus: AttendanceStatus, filter: string): boolean {
  if (filter === "all") return true;
  const group = STATUS_FILTER_GROUPS[filter];
  if (group) return group.includes(recordStatus);
  return recordStatus === filter;
}

export function AttendanceReport({
  records,
  employees,
  departments,
  initialFrom,
  initialTo,
  initialStatus,
}: {
  records: DailyAttendance[];
  employees: Employee[];
  departments: Department[];
  initialFrom?: string;
  initialTo?: string;
  initialStatus?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [from, setFrom] = useState(initialFrom ?? addDays(today(), -13));
  const [to, setTo] = useState(initialTo ?? today());
  const [departmentId, setDepartmentId] = useState<string[]>([]);
  const [employeeId, setEmployeeId] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>(
    initialStatus && initialStatus !== "all" ? [initialStatus] : [],
  );

  function fmtTime(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit" });
  }

  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const rows = useMemo(() => {
    return records
      .filter((r) => r.date >= from && r.date <= to)
      .map((r) => ({ record: r, employee: empMap.get(r.employeeId) }))
      .filter((x) => x.employee)
      .filter(({ employee }) => departmentId.length === 0 || departmentId.includes(employee!.departmentId))
      .filter(({ employee }) => employeeId.length === 0 || employeeId.includes(employee!.id))
      .filter(
        ({ record }) => status.length === 0 || status.some((s) => matchesReportStatus(record.status, s)),
      )
      .sort((a, b) => (a.record.date < b.record.date ? 1 : -1));
  }, [records, empMap, from, to, departmentId, employeeId, status]);

  const exportRows = rows.map(({ record, employee }) => [
    employee!.name,
    record.date,
    fmtTime(record.actualIn),
    fmtTime(record.actualOut),
    record.deductibleLateMinutes,
    record.earlyLeaveMinutes,
    (record.workedMinutes / 60).toFixed(1),
    attendanceStatusLabel(record.status, t),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t.reports.filterFrom}</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t.reports.filterTo}</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t.reports.filterDepartment}</Label>
          <MultiSelectFilter
            placeholder={t.common.all}
            selected={departmentId}
            onChange={setDepartmentId}
            options={departments.map((d) => ({ value: d.id, label: translateLabel(d.name, locale) }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t.reports.filterEmployee}</Label>
          <MultiSelectFilter
            placeholder={t.common.all}
            selected={employeeId}
            onChange={setEmployeeId}
            searchable
            options={employees.map((e) => ({ value: e.id, label: e.name }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t.reports.filterStatus}</Label>
          <MultiSelectFilter
            placeholder={t.common.all}
            selected={status}
            onChange={setStatus}
            options={[
              { value: "absent_late", label: t.reports.statusAbsentLate },
              ...STATUS_OPTIONS.map((value) => ({ value, label: attendanceStatusLabel(value, t) })),
            ]}
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{format(t.reports.recordsCount, { count: rows.length })}</p>
        <ExportButtons
          filename="attendance-report"
          headers={[
            t.reports.colEmployee, t.reports.colDate, t.reports.colIn, t.reports.colOut,
            t.reports.colLate, t.reports.colEarlyLeave, t.reports.colWorkedHours, t.reports.colStatus,
          ]}
          rows={exportRows}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={FileBarChart} title={t.reports.noMatch} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.reports.colEmployee}</TableHead>
                <TableHead>{t.reports.colDate}</TableHead>
                <TableHead>{t.reports.colIn}</TableHead>
                <TableHead>{t.reports.colOut}</TableHead>
                <TableHead>{t.reports.colLate}</TableHead>
                <TableHead>{t.reports.colEarlyLeave}</TableHead>
                <TableHead>{t.reports.colWorkedHours}</TableHead>
                <TableHead>{t.reports.colStatus}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ record, employee }) => (
                <TableRow key={record.id}>
                  <TableCell className="font-medium">{employee!.name}</TableCell>
                  <TableCell>{record.date}</TableCell>
                  <TableCell dir="ltr">{fmtTime(record.actualIn)}</TableCell>
                  <TableCell dir="ltr">{fmtTime(record.actualOut)}</TableCell>
                  <TableCell className="tabular-nums">{record.deductibleLateMinutes || "—"}</TableCell>
                  <TableCell className="tabular-nums">{record.earlyLeaveMinutes || "—"}</TableCell>
                  <TableCell className="tabular-nums">{(record.workedMinutes / 60).toFixed(1)}</TableCell>
                  <TableCell><AttendanceStatusBadge status={record.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
