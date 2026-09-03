import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Building2, Clock, IdCard, Calendar } from "lucide-react";
import { getDb } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { inScope, viewerScope } from "@/lib/scope";
import { formatEGP } from "@/lib/constants";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { translateLabel } from "@/lib/i18n/data-labels";
import { requestStatusLabel, deductionTypeLabel } from "@/lib/i18n/labels";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AttendanceStatusBadge } from "@/components/shared/status-badge";

export default async function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const db = await getDb();
  const user = await requireAccess("/employees");
  const t = await getT();
  const locale = await getLocale();
  const { id } = await params;
  const employee = db.employees.find((e) => e.id === id);
  if (!employee || !inScope(viewerScope(user, db.employees), id)) notFound();

  const department = db.departments.find((d) => d.id === employee.departmentId);
  const shift = db.shifts.find((s) => s.id === employee.shiftId);
  const timeFmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(locale === "ar" ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" }) : "—";

  const attendance = db.dailyAttendance
    .filter((a) => a.employeeId === employee.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 20);

  const overtime = db.overtime
    .filter((o) => o.employeeId === employee.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const deductions = db.deductions
    .filter((d) => d.employeeId === employee.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const payrollRecords = db.payrollRecords
    .filter((r) => r.employeeId === employee.id)
    .map((r) => ({ record: r, period: db.payrollPeriods.find((p) => p.id === r.periodId) }));

  return (
    <div className="flex flex-col gap-6">
      <Link href="/employees" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground w-fit">
        <ArrowRight className="h-4 w-4 rtl:rotate-180" />
        {t.employees.backToList}
      </Link>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14">
              <AvatarFallback className="text-lg">{employee.name.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-lg font-bold text-foreground">{employee.name}</h1>
              <p className="text-sm text-muted-foreground">
                {translateLabel(employee.jobTitle, locale)} · {translateLabel(department?.name ?? "", locale)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5"><IdCard className="h-4 w-4" />{employee.id}</span>
            <span className="flex items-center gap-1.5"><Building2 className="h-4 w-4" />{translateLabel(department?.name ?? "", locale)}</span>
            <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" />{translateLabel(shift?.name ?? "", locale)}</span>
            <span className="flex items-center gap-1.5"><Calendar className="h-4 w-4" />{employee.hireDate}</span>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="basic">
        <TabsList>
          <TabsTrigger value="basic">{t.employees.tabBasic}</TabsTrigger>
          <TabsTrigger value="attendance">{t.employees.tabAttendance}</TabsTrigger>
          <TabsTrigger value="overtime">{t.employees.tabOvertime}</TabsTrigger>
          <TabsTrigger value="deductions">{t.employees.tabDeductions}</TabsTrigger>
          <TabsTrigger value="payroll">{t.employees.tabPayroll}</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <Card>
            <CardContent className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={t.employees.colId} value={employee.id} />
              <Field label={t.employees.colDepartment} value={translateLabel(department?.name ?? "-", locale)} />
              <Field label={t.employees.colJobTitle} value={translateLabel(employee.jobTitle, locale)} />
              <Field label={t.employees.colShift} value={translateLabel(shift?.name ?? "-", locale)} />
              <Field label={t.employees.formHireDate} value={employee.hireDate} />
              <Field label={t.employees.colBasicSalary} value={formatEGP(employee.basicSalary, locale)} />
              <Field label={t.employees.formAllowances} value={formatEGP(employee.allowances, locale)} />
              <Field label={t.employees.formBiometricId} value={employee.biometricDeviceUserId} />
              <Field
                label={t.employees.colStatus}
                value={
                  <Badge>
                    {
                      {
                        active: t.employees.statusActive,
                        on_leave: t.employees.statusOnLeave,
                        suspended: t.employees.statusSuspended,
                        terminated: t.employees.statusTerminated,
                      }[employee.status]
                    }
                  </Badge>
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance">
          <Card>
            <CardHeader><CardTitle>{t.employees.last20Days}</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.reports.colDate}</TableHead>
                    <TableHead>{t.attendance.colIn}</TableHead>
                    <TableHead>{t.attendance.colOut}</TableHead>
                    <TableHead>{t.attendance.colLate} ({t.common.minutes})</TableHead>
                    <TableHead>{t.common.status}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendance.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.date}</TableCell>
                      <TableCell>{timeFmt(a.actualIn)}</TableCell>
                      <TableCell>{timeFmt(a.actualOut)}</TableCell>
                      <TableCell className="tabular-nums">{a.deductibleLateMinutes || "—"}</TableCell>
                      <TableCell><AttendanceStatusBadge status={a.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="overtime">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.reports.colDate}</TableHead>
                    <TableHead>{t.overtime.colHours}</TableHead>
                    <TableHead>{t.overtime.colRate}</TableHead>
                    <TableHead>{t.overtime.colAmount}</TableHead>
                    <TableHead>{t.common.status}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overtime.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t.employees.noOvertimeRecords}</TableCell></TableRow>
                  )}
                  {overtime.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>{o.date}</TableCell>
                      <TableCell className="tabular-nums">{o.hours}</TableCell>
                      <TableCell className="tabular-nums">{formatEGP(o.hourlyRate, locale)}</TableCell>
                      <TableCell className="tabular-nums">{formatEGP(o.amount, locale)}</TableCell>
                      <TableCell><Badge variant={o.status === "approved" ? "success" : o.status === "rejected" ? "destructive" : "warning"}>{requestStatusLabel(o.status, t)}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deductions">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.reports.colDate}</TableHead>
                    <TableHead>{t.deductions.colType}</TableHead>
                    <TableHead>{t.deductions.colAmount}</TableHead>
                    <TableHead>{t.deductions.colReason}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deductions.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">{t.employees.noDeductionRecords}</TableCell></TableRow>
                  )}
                  {deductions.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>{d.date}</TableCell>
                      <TableCell>{deductionTypeLabel(d.type, t)}</TableCell>
                      <TableCell className="tabular-nums text-destructive">-{formatEGP(d.amount, locale)}</TableCell>
                      <TableCell className="text-muted-foreground">{d.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payroll">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.employees.period}</TableHead>
                    <TableHead>{t.employees.grossTotal}</TableHead>
                    <TableHead>{t.payroll.colDeductions}</TableHead>
                    <TableHead>{t.payroll.netSalary}</TableHead>
                    <TableHead className="text-end">{t.payroll.colDetails}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payrollRecords.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t.employees.noPayrollRecords}</TableCell></TableRow>
                  )}
                  {payrollRecords.map(({ record, period }) => (
                    <TableRow key={record.id}>
                      <TableCell>{translateLabel(period?.label ?? "-", locale)}</TableCell>
                      <TableCell className="tabular-nums">{formatEGP(record.grossSalary, locale)}</TableCell>
                      <TableCell className="tabular-nums text-destructive">-{formatEGP(record.totalDeductions, locale)}</TableCell>
                      <TableCell className="tabular-nums font-semibold">{formatEGP(record.netSalary, locale)}</TableCell>
                      <TableCell className="text-end">
                        <Link href={`/payslip/${record.id}`} className="text-primary hover:underline">
                          {t.employees.viewBreakdown}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}
