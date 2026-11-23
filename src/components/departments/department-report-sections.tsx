import Link from "next/link";
import { formatEGP } from "@/lib/constants";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { format } from "@/lib/i18n/format";
import { deductionTypeLabel, allowanceTypeLabel, leaveTypeLabel, payrollPeriodStatusLabel } from "@/lib/i18n/labels";
import { STATEMENT_KINDS, statementKindLabel } from "@/lib/overtime-statement";
import { employeeStatusLabel } from "@/lib/department-report-export";
import type { DepartmentReport, EmployeePeriodStats } from "@/lib/department-report";
import type { AllowanceType, DeductionType, LeaveType } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClickableRow } from "@/components/shared/clickable-row";
import { AttendanceStatusBadge, RequestStatusBadge } from "@/components/shared/status-badge";

type Locale = "ar" | "en";

const DEDUCTION_TYPES: DeductionType[] = ["late", "permission_overrun", "absence", "early_leave", "permission", "unauthorized_exit", "penalty", "advance", "admin_deduction", "other"];
const ALLOWANCE_TYPES: AllowanceType[] = ["transport", "meal", "fixed", "incentive", "bonus"];
const LEAVE_TYPES: LeaveType[] = ["annual", "casual", "sick", "unpaid", "mission", "permission", "excused_absence"];

/** A card with a title; wide tables scroll inside it instead of widening the page. */
export function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="min-w-0">{children}</CardContent>
    </Card>
  );
}

function Scroll({ children }: { children: React.ReactNode }) {
  return <div className="w-full overflow-x-auto">{children}</div>;
}

/** label → value pairs in a small grid. */
export function Figures({ items }: { items: { label: string; value: string | number }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((i) => (
        <div key={i.label} className="flex flex-col gap-0.5 rounded-lg bg-muted/50 p-2">
          <dt className="text-[11px] text-muted-foreground">{i.label}</dt>
          <dd className="text-sm font-semibold tabular-nums">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-4 text-center text-sm text-muted-foreground">{text}</p>;
}

const profile = (employeeNumber: string) => `/employees/${encodeURIComponent(employeeNumber)}`;

function NameCell({ employeeNumber, name, link }: { employeeNumber: string; name: string; link: boolean }) {
  return link ? (
    <Link href={profile(employeeNumber)} className="font-medium hover:underline">
      {name}
    </Link>
  ) : (
    <span className="font-medium">{name}</span>
  );
}

export function TopTable({ rows, value, unit, t, link }: { rows: EmployeePeriodStats[]; value: (r: EmployeePeriodStats) => number; unit: string; t: Dictionary; link: boolean }) {
  const r = t.departmentReport;
  if (rows.length === 0) return <Empty text={r.nothing} />;
  return (
    <Scroll>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{r.colNumber}</TableHead>
            <TableHead>{r.colName}</TableHead>
            <TableHead className="text-end">{unit}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.employeeId}>
              <TableCell className="tabular-nums">{row.employeeNumber}</TableCell>
              <TableCell><NameCell employeeNumber={row.employeeNumber} name={row.name} link={link} /></TableCell>
              <TableCell className="text-end tabular-nums">{value(row)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Scroll>
  );
}

export function LeavesSection({ report, t }: { report: DepartmentReport; t: Dictionary }) {
  const r = t.departmentReport;
  const l = report.leaves;
  return (
    <Section title={r.leavesTitle}>
      <div className="flex flex-col gap-4">
        <Figures
          items={[
            ...LEAVE_TYPES.map((type) => ({ label: leaveTypeLabel(type, t), value: l.daysByType[type] })),
            { label: r.leavePending, value: l.pending },
            { label: r.balanceTotal, value: l.balanceTotal },
            { label: r.balanceAverage, value: l.balanceAverage },
          ]}
        />
        <div>
          <p className="mb-2 text-sm font-semibold">{r.topLeaveTakers}</p>
          {l.topTakers.length === 0 ? (
            <Empty text={r.nothing} />
          ) : (
            <Scroll>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{r.colNumber}</TableHead>
                    <TableHead>{r.colName}</TableHead>
                    <TableHead className="text-end">{r.colDays}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {l.topTakers.map((x) => (
                    <TableRow key={x.employeeNumber}>
                      <TableCell className="tabular-nums">{x.employeeNumber}</TableCell>
                      <TableCell>{x.name}</TableCell>
                      <TableCell className="text-end tabular-nums">{x.days}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Scroll>
          )}
        </div>
      </div>
    </Section>
  );
}

export function OvertimeSection({ overtime, t, locale }: { overtime: NonNullable<DepartmentReport["overtime"]>; t: Dictionary; locale: Locale }) {
  const r = t.departmentReport;
  return (
    <Section title={r.overtimeTitle}>
      <Figures
        items={[
          { label: r.approvedHours, value: overtime.total.hours },
          { label: r.approvedAmount, value: formatEGP(overtime.total.amount, locale) },
          ...STATEMENT_KINDS.map((kind) => ({ label: statementKindLabel(kind, t), value: formatEGP(overtime.total.byKind[kind], locale) })),
          { label: r.pendingHours, value: overtime.total.pendingHours },
          { label: r.pendingAmount, value: formatEGP(overtime.total.pendingAmount, locale) },
        ]}
      />
    </Section>
  );
}

export function DeductionsSection({ deductions, t, locale }: { deductions: NonNullable<DepartmentReport["deductions"]>; t: Dictionary; locale: Locale }) {
  const r = t.departmentReport;
  return (
    <Section title={r.deductionsTitle}>
      <div className="flex flex-col gap-4">
        <Figures
          items={[
            ...DEDUCTION_TYPES.map((type) => ({ label: deductionTypeLabel(type, t), value: formatEGP(deductions.byType[type], locale) })),
            { label: r.deductionsTotal, value: formatEGP(deductions.total, locale) },
          ]}
        />
        <div>
          <p className="mb-2 text-sm font-semibold">{r.allowancesTitle}</p>
          <Figures
            items={[
              ...ALLOWANCE_TYPES.map((type) => ({ label: allowanceTypeLabel(type, t), value: formatEGP(deductions.allowancesByType[type], locale) })),
              { label: r.allowancesTotal, value: formatEGP(deductions.allowancesTotal, locale) },
            ]}
          />
        </div>
      </div>
    </Section>
  );
}

export function PayrollSection({ payroll, t, locale }: { payroll: NonNullable<DepartmentReport["payroll"]>; t: Dictionary; locale: Locale }) {
  const r = t.departmentReport;
  if (!payroll.period) {
    return (
      <Section title={r.payrollTitle}>
        <Empty text={r.noPayroll} />
      </Section>
    );
  }
  return (
    <Section title={r.payrollTitle} description={`${payroll.period.label} — ${payrollPeriodStatusLabel(payroll.period.status, t)}`}>
      <Figures
        items={[
          { label: r.colBasic, value: formatEGP(payroll.total.basicSalary, locale) },
          { label: r.colAllowances, value: formatEGP(payroll.total.allowances, locale) },
          { label: r.colOvertime, value: formatEGP(payroll.total.overtime, locale) },
          { label: r.colGross, value: formatEGP(payroll.total.gross, locale) },
          { label: r.colDeductions, value: formatEGP(payroll.total.deductions, locale) },
          { label: r.colNet, value: formatEGP(payroll.total.net, locale) },
        ]}
      />
    </Section>
  );
}

export function CostSection({ cost, t, locale }: { cost: NonNullable<DepartmentReport["cost"]>; t: Dictionary; locale: Locale }) {
  const r = t.departmentReport;
  return (
    <Section title={r.costTitle} description={format(r.costMonth, { month: `${cost.year}-${String(cost.month).padStart(2, "0")}` })}>
      <Figures
        items={[
          { label: r.costTotal, value: formatEGP(cost.total, locale) },
          { label: r.colOvertime, value: formatEGP(cost.overtime, locale) },
          { label: r.colDeductions, value: formatEGP(cost.deductions, locale) },
        ]}
      />
    </Section>
  );
}

export function RequestsSection({ requests, t }: { requests: NonNullable<DepartmentReport["requests"]>; t: Dictionary }) {
  const r = t.departmentReport;
  return (
    <Section title={r.requestsTitle}>
      {requests.length === 0 ? (
        <Empty text={r.nothing} />
      ) : (
        <Scroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.common.date}</TableHead>
                <TableHead>{r.colType}</TableHead>
                <TableHead>{r.colTime}</TableHead>
                <TableHead>{r.colEmployees}</TableHead>
                <TableHead>{t.common.status}</TableHead>
                <TableHead>{r.colRequestedBy}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="tabular-nums">{q.date}</TableCell>
                  <TableCell>{q.type === "late_work" ? t.workRequests.typeLateWork : t.workRequests.typeOther}</TableCell>
                  <TableCell className="tabular-nums">{q.fromTime ? `${q.fromTime} → ${q.toTime ?? ""}` : "—"}</TableCell>
                  <TableCell className="max-w-64 truncate" title={q.employees.join("، ")}>{q.employees.join("، ")}</TableCell>
                  <TableCell><RequestStatusBadge status={q.status} /></TableCell>
                  <TableCell>{q.requestedBy}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Scroll>
      )}
    </Section>
  );
}

export function DocumentsSection({ documents, t }: { documents: NonNullable<DepartmentReport["documents"]>; t: Dictionary }) {
  const r = t.departmentReport;
  return (
    <Section title={r.documentsTitle} description={String(documents.length)}>
      {documents.length === 0 ? (
        <Empty text={r.noMissing} />
      ) : (
        <Scroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{r.colNumber}</TableHead>
                <TableHead>{r.colName}</TableHead>
                <TableHead className="text-end">{r.missingDocuments}</TableHead>
                <TableHead className="text-end">{r.missingAcknowledgments}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((d) => (
                <ClickableRow key={d.employeeNumber} href={profile(d.employeeNumber)}>
                  <TableCell className="tabular-nums">{d.employeeNumber}</TableCell>
                  <TableCell><NameCell employeeNumber={d.employeeNumber} name={d.name} link /></TableCell>
                  <TableCell className="text-end tabular-nums">{d.missingDocuments}</TableCell>
                  <TableCell className="text-end tabular-nums">{d.missingAcknowledgments}</TableCell>
                </ClickableRow>
              ))}
            </TableBody>
          </Table>
        </Scroll>
      )}
    </Section>
  );
}

/** The department's employees. A row opens the employee's file for who may open it (the "employees" permission). */
export function EmployeesSection({ report, t, link }: { report: DepartmentReport; t: Dictionary; link: boolean }) {
  const r = t.departmentReport;
  return (
    <Section title={r.employeesTitle} description={String(report.employees.length)}>
      {report.employees.length === 0 ? (
        <Empty text={r.noEmployees} />
      ) : (
        <Scroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{r.colNumber}</TableHead>
                <TableHead>{r.colName}</TableHead>
                <TableHead>{t.common.status}</TableHead>
                <TableHead>{r.colPayType}</TableHead>
                <TableHead>{r.colToday}</TableHead>
                <TableHead className="text-end">{r.absentDays}</TableHead>
                <TableHead className="text-end">{r.lateMinutes}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.employees.map((e) => {
                const cells = (
                  <>
                    <TableCell className="tabular-nums">{e.employeeNumber}</TableCell>
                    <TableCell><NameCell employeeNumber={e.employeeNumber} name={e.name} link={link} /></TableCell>
                    <TableCell>{employeeStatusLabel(e.status, t)}</TableCell>
                    <TableCell>{e.payType}</TableCell>
                    <TableCell>{e.todayStatus ? <AttendanceStatusBadge status={e.todayStatus} /> : "—"}</TableCell>
                    <TableCell className="text-end tabular-nums">{e.absentDays}</TableCell>
                    <TableCell className="text-end tabular-nums">{e.lateMinutes}</TableCell>
                  </>
                );
                return link ? (
                  <ClickableRow key={e.employeeId} href={profile(e.employeeNumber)}>{cells}</ClickableRow>
                ) : (
                  <TableRow key={e.employeeId}>{cells}</TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Scroll>
      )}
    </Section>
  );
}
