import { getDb, getAttendanceLogsForDate } from "@/lib/data";
import { requireAccess } from "@/lib/auth";
import { employeesInScope, viewerScope } from "@/lib/scope";
import { hasPermission } from "@/lib/permissions";
import { today } from "@/lib/today";
import { getT } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DailyAttendanceTable } from "@/components/attendance/daily-attendance-table";
import { RawLogsTable } from "@/components/attendance/raw-logs-table";
import { DateNav } from "@/components/attendance/date-nav";
import { ManualAttendanceDialog } from "@/components/attendance/manual-attendance-dialog";
import { attendanceSummary } from "@/lib/attendance-engine";
import { KpiCard } from "@/components/shared/kpi-card";
import { UserCheck, UserX, Clock3, Fingerprint, CalendarClock } from "lucide-react";
import { loadPayContext } from "@/lib/pay-context";
import { loadMidDayInputs, midDayForDay } from "@/lib/mid-day-view";
import type { MidDayAnalysis } from "@/lib/mid-day-exits";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; status?: string }>;
}) {
  const { date: dateParam, status: statusParam } = await searchParams;
  const date = dateParam ?? today();
  const initialStatus = statusParam ?? "all";
  const db = await getDb();
  const user = await requireAccess("/attendance");
  const t = await getT();
  const canCorrect = hasPermission(user, "attendance");

  const scope = viewerScope(user, db.employees);
  const employees = employeesInScope(scope, db.employees).filter((e) => e.status === "active");
  const employeeIds = new Set(employees.map((e) => e.id));

  const records = db.dailyAttendance.filter((a) => a.date === date && employeeIds.has(a.employeeId));
  const logs = await getAttendanceLogsForDate(date, employeeIds);
  const summary = attendanceSummary(records);

  // the day's exits in the middle of it and timed permissions, read the way the pay rules read them
  const ctx = await loadPayContext();
  const midDayInputs = await loadMidDayInputs(ctx, employees, [date]);
  const midDay: Record<string, MidDayAnalysis> = {};
  for (const r of records) {
    const employee = employees.find((e) => e.id === r.employeeId);
    if (!employee) continue;
    const a = midDayForDay(
      ctx,
      employee,
      { date, actualIn: r.actualIn ? new Date(r.actualIn) : null, actualOut: r.actualOut ? new Date(r.actualOut) : null, corrected: Boolean(r.correctionReason) },
      midDayInputs(r.employeeId, date),
    );
    if (a) midDay[r.id] = a;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.attendance.title}
        description={t.attendance.description}
        actions={canCorrect ? <ManualAttendanceDialog employees={employees} /> : null}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <DateNav date={date} />
        <div className="grid grid-cols-3 gap-2 sm:flex sm:gap-3">
          <KpiCard label={t.attendance.present} value={summary.present + summary.late + summary.earlyLeave} icon={UserCheck} tone="success" href={`/attendance?date=${date}&status=present`} />
          <KpiCard label={t.attendance.late} value={summary.late} icon={Clock3} tone="warning" href={`/attendance?date=${date}&status=late`} />
          <KpiCard label={t.attendance.absent} value={summary.absent} icon={UserX} tone="destructive" href={`/attendance?date=${date}&status=absent`} />
          <KpiCard label={t.attendance.onLeave} value={summary.leave} icon={CalendarClock} tone="primary" href={`/attendance?date=${date}&status=leave`} />
          <KpiCard label={t.attendance.missingPunch} value={summary.missingPunch} icon={Fingerprint} tone="warning" href={`/attendance?date=${date}&status=missing_punch`} />
        </div>
      </div>

      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily">{t.attendance.dailyTab}</TabsTrigger>
          <TabsTrigger value="raw">{t.attendance.rawTab}</TabsTrigger>
        </TabsList>
        <TabsContent value="daily">
          <DailyAttendanceTable
            key={`${date}:${initialStatus}`}
            records={records}
            employees={employees}
            departments={db.departments}
            canCorrect={canCorrect}
            initialStatus={initialStatus}
            midDay={midDay}
          />
        </TabsContent>
        <TabsContent value="raw">
          <RawLogsTable logs={logs} employees={employees} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
