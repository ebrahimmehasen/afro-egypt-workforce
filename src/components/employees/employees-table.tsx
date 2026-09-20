"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, Users, FileWarning, Fingerprint } from "lucide-react";
import { Employee, Department, Shift } from "@/lib/types";
import { deviceLink } from "@/lib/device-link";
import { getDeviceUserNamesAction } from "@/lib/actions/device-users";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MultiSelectFilter } from "@/components/shared/multi-select-filter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClickableRow } from "@/components/shared/clickable-row";
import { EmptyState } from "@/components/shared/empty-state";
import { formatEGP } from "@/lib/constants";
import { translateLabel } from "@/lib/i18n/data-labels";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { today } from "@/lib/today";

const STATUS_VARIANT: Record<Employee["status"], "success" | "secondary" | "warning" | "destructive"> = {
  active: "success",
  on_leave: "secondary",
  terminated: "destructive",
};

/** True while the employee is still inside their first 3 months (hire date + 3 months hasn't arrived yet). */
function isNewHire(hireDate: string, todayStr: string): boolean {
  const cutoff = new Date(`${hireDate}T00:00:00Z`);
  if (Number.isNaN(cutoff.getTime())) return false;
  cutoff.setUTCMonth(cutoff.getUTCMonth() + 3);
  return todayStr < cutoff.toISOString().slice(0, 10);
}

/** The fingerprint-device column: the name the device itself holds for this employee, or why it isn't shown. */
function DeviceCell({ employee, names }: { employee: Employee; names: Record<string, string> | null }) {
  const t = useT();
  const link = deviceLink(employee.biometricDeviceUserId, names);

  if (link.state === "not_linked") {
    return <span className="text-xs text-muted-foreground">{t.employees.deviceNotLinked}</span>;
  }
  return (
    <span className="flex items-center gap-1.5">
      <Fingerprint className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
      {link.state === "named" ? (
        <span>{link.name}</span>
      ) : link.state === "missing" ? (
        <span className="text-xs text-warning">{t.employees.deviceMissingOnDevice}</span>
      ) : (
        <span className="text-xs text-muted-foreground">{t.employees.deviceLinked}</span>
      )}
    </span>
  );
}

export function EmployeesTable({
  employees,
  departments,
  shifts,
  incompleteDocIds = [],
}: {
  employees: Employee[];
  departments: Department[];
  shifts: Shift[];
  incompleteDocIds?: string[];
}) {
  const t = useT();
  const locale = useLocale();
  const incompleteDocs = new Set(incompleteDocIds);
  const todayStr = today();
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [tenureFilter, setTenureFilter] = useState<string[]>([]);
  // The names the fingerprint device itself holds. Asked for after the list is on screen, never
  // before it: the device is on the factory network and can be slow or off, and the roster must
  // not wait for it. Until (or unless) they arrive, a linked employee just reads "مربوط".
  const [deviceNames, setDeviceNames] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDeviceUserNamesAction()
      .then((res) => {
        if (!cancelled && "names" in res) setDeviceNames(res.names);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const STATUS_LABEL: Record<Employee["status"], string> = {
    active: t.employees.statusActive,
    on_leave: t.employees.statusOnLeave,
    terminated: t.employees.statusTerminated,
  };

  const deptMap = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);
  const shiftMap = useMemo(() => new Map(shifts.map((s) => [s.id, s.name])), [shifts]);

  const filtered = useMemo(() => {
    return employees.filter((e) => {
      const matchesSearch =
        !search ||
        e.name.toLowerCase().includes(search.toLowerCase()) ||
        e.employeeNumber.toLowerCase().includes(search.toLowerCase());
      const matchesDept = deptFilter.length === 0 || deptFilter.includes(e.departmentId);
      const matchesStatus = statusFilter.length === 0 || statusFilter.includes(e.status);
      const matchesTenure =
        tenureFilter.length === 0 || tenureFilter.includes(isNewHire(e.hireDate, todayStr) ? "new" : "established");
      return matchesSearch && matchesDept && matchesStatus && matchesTenure;
    });
  }, [employees, search, deptFilter, statusFilter, tenureFilter, todayStr]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t.employees.searchPlaceholder}
            className="ps-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <MultiSelectFilter
          className="sm:w-48"
          placeholder={t.common.allDepartments}
          selected={deptFilter}
          onChange={setDeptFilter}
          options={departments.map((d) => ({ value: d.id, label: translateLabel(d.name, locale) }))}
        />
        <MultiSelectFilter
          className="sm:w-44"
          placeholder={t.common.allStatuses}
          selected={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "active", label: t.employees.statusActive },
            { value: "on_leave", label: t.employees.statusOnLeave },
            { value: "terminated", label: t.employees.statusTerminated },
          ]}
        />
        <MultiSelectFilter
          className="sm:w-52"
          placeholder={t.employees.tenureAll}
          selected={tenureFilter}
          onChange={setTenureFilter}
          options={[
            { value: "new", label: t.employees.tenureNew },
            { value: "established", label: t.employees.tenureEstablished },
          ]}
        />
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="h-3 w-3 rounded-sm border border-gold-400/50 bg-gold-400/25" />
        {t.employees.newHireLegend}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title={t.employees.noMatch} description={t.employees.noMatchDesc} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.employees.colId}</TableHead>
                <TableHead>{t.employees.colName}</TableHead>
                <TableHead>{t.employees.colDepartment}</TableHead>
                <TableHead>{t.employees.colJobTitle}</TableHead>
                <TableHead>{t.employees.colDevice}</TableHead>
                <TableHead>{t.employees.colShift}</TableHead>
                <TableHead>{t.employees.colBasicSalary}</TableHead>
                <TableHead>{t.employees.colStatus}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => (
                <ClickableRow
                  key={e.id}
                  href={`/employees/${e.employeeNumber}`}
                  className={isNewHire(e.hireDate, todayStr) ? "bg-gold-400/15 hover:bg-gold-400/25" : undefined}
                >
                  <TableCell dir="ltr" className="font-mono text-xs tabular-nums">{e.employeeNumber}</TableCell>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1.5">
                      {/* a real link keeps keyboard and middle-click working; the row click covers the rest */}
                      <Link
                        href={`/employees/${e.employeeNumber}`}
                        onClick={(ev) => ev.stopPropagation()}
                        className="hover:underline"
                      >
                        {e.name}
                      </Link>
                      {incompleteDocs.has(e.id) && (
                        <FileWarning className="h-3.5 w-3.5 text-warning" aria-label={t.documents.incomplete} />
                      )}
                    </span>
                  </TableCell>
                  <TableCell>{translateLabel(deptMap.get(e.departmentId) ?? "", locale)}</TableCell>
                  <TableCell>{translateLabel(e.jobTitle, locale)}</TableCell>
                  <TableCell><DeviceCell employee={e} names={deviceNames} /></TableCell>
                  <TableCell>{translateLabel(shiftMap.get(e.shiftId) ?? "", locale)}</TableCell>
                  <TableCell className="tabular-nums">{formatEGP(e.basicSalary, locale)}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[e.status]}>{STATUS_LABEL[e.status]}</Badge></TableCell>
                </ClickableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
