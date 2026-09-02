import { getDb } from "@/lib/data";
import { getSession } from "@/lib/auth";
import { canCorrectAttendance } from "@/lib/permissions";
import { DEMO_DATE } from "@/lib/constants";
import { getT } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SimulatePunchDialog } from "@/components/attendance/simulate-punch-dialog";
import { DailyAttendanceTable } from "@/components/attendance/daily-attendance-table";
import { RawLogsTable } from "@/components/attendance/raw-logs-table";
import { DateNav } from "@/components/attendance/date-nav";
import { attendanceSummary } from "@/lib/attendance-engine";
import { KpiCard } from "@/components/shared/kpi-card";
import { UserCheck, UserX, Clock3, Fingerprint, CalendarClock } from "lucide-react";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; status?: string }>;
}) {
  const { date: dateParam, status: statusParam } = await searchParams;
  const date = dateParam ?? DEMO_DATE;
  const initialStatus = statusParam ?? "all";
  const db = getDb();
  const user = (await getSession())!;
  const t = await getT();
  const canCorrect = canCorrectAttendance(user.role);

  let employees = db.employees.filter((e) => e.status === "active");
  if (user.role === "employee" && user.employeeId) {
    employees = employees.filter((e) => e.id === user.employeeId);
  } else if (user.role === "supervisor" && user.departmentId) {
    employees = employees.filter((e) => e.departmentId === user.departmentId);
  }
  const employeeIds = new Set(employees.map((e) => e.id));
  const canSimulate = user.role !== "employee";

  const records = db.dailyAttendance.filter((a) => a.date === date && employeeIds.has(a.employeeId));
  const logs = db.attendanceLogs.filter((l) => l.timestamp.startsWith(date) && employeeIds.has(l.employeeId));
  const summary = attendanceSummary(records);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.attendance.title}
        description={t.attendance.description}
        actions={canSimulate ? <SimulatePunchDialog employees={employees} /> : null}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <DateNav date={date} />
        <div className="grid grid-cols-3 gap-2 sm:flex sm:gap-3">
          <KpiCard label={t.attendance.present} value={summary.present + summary.late} icon={UserCheck} tone="success" href={`/attendance?date=${date}&status=present`} />
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
          />
        </TabsContent>
        <TabsContent value="raw">
          <RawLogsTable logs={logs} employees={employees} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
