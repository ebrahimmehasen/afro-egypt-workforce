import { CircleCheck, CircleX, HardDrive, ListOrdered, Users } from "lucide-react";
import { requireAccess } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { getT } from "@/lib/i18n";
import { getDeviceConnection, getDeviceSnapshot, fetchDeviceAttendanceLogs } from "@/lib/zk-device";
import { attendanceRealtimeStatus } from "@/lib/attendance-realtime";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/shared/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { DeviceConnectionForm } from "@/components/biometric-device/connection-form";
import { DeviceActions } from "@/components/biometric-device/device-actions";
import { DeviceUsersTable } from "@/components/biometric-device/users-table";
import { SyncAttendanceCard } from "@/components/biometric-device/sync-attendance-card";
import { PunchedTodayCard } from "@/components/biometric-device/punched-today-card";

export default async function BiometricDevicePage() {
  await requireAccess("/biometric-device");

  const t = await getT();
  // getDeviceSnapshot() and fetchDeviceAttendanceLogs() both hold the
  // device's one connection slot (via withDevice) - they have to run one
  // after the other, not inside the same Promise.all, or they'd fight each
  // other and the real-time listener for the socket.
  const [connection, db] = await Promise.all([getDeviceConnection(), getDb()]);
  const snapshot = await getDeviceSnapshot();
  const rawAttendance = snapshot.online ? await fetchDeviceAttendanceLogs() : [];

  const now = new Date();
  const isToday = (d: Date) => d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const todayPunchedUserIds = new Set(rawAttendance.filter((r) => isToday(r.recordTime)).map((r) => r.deviceUserId));

  const punchCounts: Record<string, number> = {};
  for (const r of rawAttendance) {
    punchCounts[r.deviceUserId] = (punchCounts[r.deviceUserId] ?? 0) + 1;
  }

  const deviceUserById = new Map(snapshot.online ? snapshot.users.map((u) => [u.userId, u]) : []);
  const employeeByDeviceUserId = new Map(db.employees.filter((e) => e.biometricDeviceUserId).map((e) => [e.biometricDeviceUserId!, e]));
  const todayList = [...todayPunchedUserIds]
    .map((deviceUserId) => {
      const todayRecords = rawAttendance.filter((r) => r.deviceUserId === deviceUserId && isToday(r.recordTime));
      const times = todayRecords.map((r) => r.recordTime.getTime()).sort((a, b) => a - b);
      return {
        deviceUserId,
        uid: deviceUserById.get(deviceUserId)?.uid ?? 0,
        name: deviceUserById.get(deviceUserId)?.name ?? deviceUserId,
        linkedEmployeeName: employeeByDeviceUserId.get(deviceUserId)?.name ?? null,
        firstPunch: new Date(times[0]).toISOString(),
        lastPunch: new Date(times[times.length - 1]).toISOString(),
        punchCount: times.length,
      };
    })
    .sort((a, b) => a.firstPunch.localeCompare(b.firstPunch));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.biometricDevice.title} description={t.biometricDevice.description} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          label={snapshot.online ? t.biometricDevice.statusConnected : t.biometricDevice.statusOffline}
          value={connection.ip}
          icon={snapshot.online ? CircleCheck : CircleX}
          tone={snapshot.online ? "success" : "destructive"}
        />
        <KpiCard
          label={t.biometricDevice.usersOnDevice}
          value={snapshot.online ? snapshot.info.userCounts : "—"}
          icon={Users}
          tone="primary"
        />
        <PunchedTodayCard count={snapshot.online ? todayPunchedUserIds.size : null} people={todayList} />
        <KpiCard
          label={t.biometricDevice.logsStored}
          value={snapshot.online ? snapshot.info.logCounts.toLocaleString() : "—"}
          icon={ListOrdered}
          tone="default"
        />
        <KpiCard
          label={t.biometricDevice.logCapacity}
          value={snapshot.online ? snapshot.info.logCapacity.toLocaleString() : "—"}
          icon={HardDrive}
          tone="default"
        />
      </div>

      {!snapshot.online && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            {t.biometricDevice.deviceUnreachable} — {snapshot.error}
          </CardContent>
        </Card>
      )}

      <SyncAttendanceCard initialStatus={attendanceRealtimeStatus()} />
      <DeviceConnectionForm connection={connection} />
      <DeviceActions />

      {snapshot.online && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-foreground">{t.biometricDevice.usersTitle}</h2>
              <p className="text-sm text-muted-foreground">{t.biometricDevice.usersDesc}</p>
            </div>
            <DeviceUsersTable users={snapshot.users} employees={db.employees} punchCounts={punchCounts} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
