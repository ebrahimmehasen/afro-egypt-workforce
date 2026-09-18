"use client";

import { useMemo, useState } from "react";
import { Search, CalendarX } from "lucide-react";
import { DailyAttendance, Department, Employee } from "@/lib/types";
import { matchesAttendanceStatusFilter } from "@/lib/attendance-engine";
import { Input } from "@/components/ui/input";
import { MultiSelectFilter } from "@/components/shared/multi-select-filter";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AttendanceStatusBadge } from "@/components/shared/status-badge";
import { CorrectAttendanceDialog } from "@/components/attendance/correct-attendance-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { intlLocale } from "@/lib/i18n/format";
import { translateLabel } from "@/lib/i18n/data-labels";

export function DailyAttendanceTable({
  records,
  employees,
  departments,
  canCorrect,
  initialStatus = "all",
}: {
  records: DailyAttendance[];
  employees: Employee[];
  departments: Department[];
  canCorrect: boolean;
  /** Status filter to pre-select, e.g. from a dashboard KPI link (`?status=absent`). */
  initialStatus?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>(initialStatus === "all" ? [] : [initialStatus]);

  function fmtTime(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit" });
  }

  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const rows = useMemo(() => {
    return records
      .map((r) => ({ record: r, employee: empMap.get(r.employeeId) }))
      .filter(({ employee }) => employee)
      .filter(({ employee }) => dept.length === 0 || dept.includes(employee!.departmentId))
      .filter(
        ({ record }) => status.length === 0 || status.some((s) => matchesAttendanceStatusFilter(record.status, s)),
      )
      .filter(
        ({ employee }) =>
          !search ||
          employee!.name.toLowerCase().includes(search.toLowerCase()) ||
          employee!.id.toLowerCase().includes(search.toLowerCase()),
      )
      .sort((a, b) => a.employee!.name.localeCompare(b.employee!.name, locale === "ar" ? "ar" : "en"));
  }, [records, empMap, dept, status, search, locale]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t.attendance.searchEmployee} className="ps-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <MultiSelectFilter
          className="sm:w-48"
          placeholder={t.common.allDepartments}
          selected={dept}
          onChange={setDept}
          options={departments.map((d) => ({ value: d.id, label: translateLabel(d.name, locale) }))}
        />
        <MultiSelectFilter
          className="sm:w-44"
          placeholder={t.common.allStatuses}
          selected={status}
          onChange={setStatus}
          options={[
            { value: "present", label: t.statuses.present },
            { value: "late", label: t.statuses.late },
            { value: "absent", label: t.statuses.absent },
            { value: "leave", label: t.statuses.leave },
            { value: "early_leave", label: t.statuses.earlyLeave },
            { value: "missing_punch", label: t.statuses.missingPunch },
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={CalendarX} title={t.attendance.noRecordsToday} description={t.attendance.noRecordsTodayDesc} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.common.employee}</TableHead>
                <TableHead>{t.attendance.colIn}</TableHead>
                <TableHead>{t.attendance.colOut}</TableHead>
                <TableHead>{t.attendance.colLate}</TableHead>
                <TableHead>{t.attendance.colEarlyLeave}</TableHead>
                <TableHead>{t.attendance.colWorkedHours}</TableHead>
                <TableHead>{t.common.status}</TableHead>
                {canCorrect && <TableHead className="text-end">{t.attendance.correctionAction}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ record, employee }) => (
                <TableRow key={record.id}>
                  <TableCell>
                    <div className="font-medium">{employee!.name}</div>
                    <div className="text-xs text-muted-foreground">{employee!.id}</div>
                  </TableCell>
                  <TableCell className="tabular-nums" dir="ltr">{fmtTime(record.actualIn)}</TableCell>
                  <TableCell className="tabular-nums" dir="ltr">{fmtTime(record.actualOut)}</TableCell>
                  <TableCell className="tabular-nums">{record.deductibleLateMinutes ? `${record.deductibleLateMinutes} ${t.common.minutes}` : "—"}</TableCell>
                  <TableCell className="tabular-nums">{record.earlyLeaveMinutes ? `${record.earlyLeaveMinutes} ${t.common.minutes}` : "—"}</TableCell>
                  <TableCell className="tabular-nums">{record.workedMinutes ? `${(record.workedMinutes / 60).toFixed(1)} ${t.common.hours}` : "—"}</TableCell>
                  <TableCell><AttendanceStatusBadge status={record.status} /></TableCell>
                  {canCorrect && (
                    <TableCell className="text-end">
                      <CorrectAttendanceDialog record={record} employeeName={employee!.name} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
