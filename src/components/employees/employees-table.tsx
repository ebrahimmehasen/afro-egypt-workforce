"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Eye, Users } from "lucide-react";
import { Employee, Department, Shift } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmployeeFormDialog } from "@/components/employees/employee-form-dialog";
import { DeleteEmployeeButton } from "@/components/employees/delete-employee-button";
import { EmptyState } from "@/components/shared/empty-state";
import { formatEGP } from "@/lib/constants";
import { translateLabel } from "@/lib/i18n/data-labels";
import { useLocale, useT } from "@/components/providers/locale-provider";

const STATUS_VARIANT: Record<Employee["status"], "success" | "secondary" | "warning" | "destructive"> = {
  active: "success",
  on_leave: "secondary",
  suspended: "warning",
  terminated: "destructive",
};

export function EmployeesTable({
  employees,
  departments,
  shifts,
  canEdit,
}: {
  employees: Employee[];
  departments: Department[];
  shifts: Shift[];
  canEdit: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const STATUS_LABEL: Record<Employee["status"], string> = {
    active: t.employees.statusActive,
    on_leave: t.employees.statusOnLeave,
    suspended: t.employees.statusSuspended,
    terminated: t.employees.statusTerminated,
  };

  const deptMap = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);
  const shiftMap = useMemo(() => new Map(shifts.map((s) => [s.id, s.name])), [shifts]);

  const filtered = useMemo(() => {
    return employees.filter((e) => {
      const matchesSearch =
        !search ||
        e.name.toLowerCase().includes(search.toLowerCase()) ||
        e.id.toLowerCase().includes(search.toLowerCase());
      const matchesDept = deptFilter === "all" || e.departmentId === deptFilter;
      const matchesStatus = statusFilter === "all" || e.status === statusFilter;
      return matchesSearch && matchesDept && matchesStatus;
    });
  }, [employees, search, deptFilter, statusFilter]);

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
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="sm:w-48"><SelectValue placeholder={t.common.allDepartments} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.common.allDepartments}</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>{translateLabel(d.name, locale)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-44"><SelectValue placeholder={t.common.allStatuses} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.common.allStatuses}</SelectItem>
            <SelectItem value="active">{t.employees.statusActive}</SelectItem>
            <SelectItem value="on_leave">{t.employees.statusOnLeave}</SelectItem>
            <SelectItem value="suspended">{t.employees.statusSuspended}</SelectItem>
            <SelectItem value="terminated">{t.employees.statusTerminated}</SelectItem>
          </SelectContent>
        </Select>
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
                <TableHead>{t.employees.colShift}</TableHead>
                <TableHead>{t.employees.colBasicSalary}</TableHead>
                <TableHead>{t.employees.colStatus}</TableHead>
                <TableHead className="text-end">{t.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs tabular-nums">{e.id}</TableCell>
                  <TableCell className="font-medium">{e.name}</TableCell>
                  <TableCell>{translateLabel(deptMap.get(e.departmentId) ?? "", locale)}</TableCell>
                  <TableCell>{translateLabel(e.jobTitle, locale)}</TableCell>
                  <TableCell>{translateLabel(shiftMap.get(e.shiftId) ?? "", locale)}</TableCell>
                  <TableCell className="tabular-nums">{formatEGP(e.basicSalary, locale)}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[e.status]}>{STATUS_LABEL[e.status]}</Badge></TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/employees/${e.id}`}>
                        <Button variant="ghost" size="icon" aria-label={t.common.view}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                      {canEdit && (
                        <>
                          <EmployeeFormDialog departments={departments} shifts={shifts} employee={e} />
                          <DeleteEmployeeButton id={e.id} name={e.name} />
                        </>
                      )}
                    </div>
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
