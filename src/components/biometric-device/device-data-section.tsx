import { CircleCheck, CircleX, HardDrive, ListOrdered, Users } from "lucide-react";
import { getDb } from "@/lib/data";
import { getT } from "@/lib/i18n";
import { format, intlLocale } from "@/lib/i18n/format";
import { getLocale } from "@/lib/i18n/locale";
import { getDeviceConnection, getDeviceOverview } from "@/lib/zk-device";
import { KpiCard } from "@/components/shared/kpi-card";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DeviceUsersTable } from "@/components/biometric-device/users-table";
import { PunchedTodayCard } from "@/components/biometric-device/punched-today-card";
import { RetryButton } from "@/components/biometric-device/retry-button";

/** How long the page waits for the device before showing what it has (or "unreachable"). */
const DEVICE_WAIT_MS = 8000;

/** Shown while the device is being read — the rest of the page is already usable. */
export async function DeviceDataFallback() {
  const t = await getT();
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <p className="text-center text-sm text-muted-foreground">{t.biometricDevice.loadingDeviceData}</p>
    </div>
  );
}

/** The device-backed part of the page: counters, today's punches and the user list. */
export async function DeviceDataSection() {
  const t = await getT();
  const locale = await getLocale();
  const [connection, db, overview] = await Promise.all([getDeviceConnection(), getDb(), getDeviceOverview(DEVICE_WAIT_MS)]);

  const online = overview.online;
  const rawAttendance = online ? overview.logs : [];

  const now = new Date();
  const isToday = (d: Date) => d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const todayPunchedUserIds = new Set(rawAttendance.filter((r) => isToday(r.recordTime)).map((r) => r.deviceUserId));

  const punchCounts: Record<string, number> = {};
  for (const r of rawAttendance) {
    punchCounts[r.deviceUserId] = (punchCounts[r.deviceUserId] ?? 0) + 1;
  }

  const deviceUserById = new Map(online ? overview.users.map((u) => [u.userId, u]) : []);
  const employeeByDeviceUserId = new Map(db.employees.filter((e) => e.biometricDeviceUserId).map((e) => [e.biometricDeviceUserId!, e]));
  const todayList = [...todayPunchedUserIds]
    .map((deviceUserId) => {
      const times = rawAttendance
        .filter((r) => r.deviceUserId === deviceUserId && isToday(r.recordTime))
        .map((r) => r.recordTime.getTime())
        .sort((a, b) => a - b);
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
      {online && overview.stale && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <span>
              {format(t.biometricDevice.staleNotice, {
                time: new Date(overview.fetchedAt).toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit" }),
              })}
            </span>
            <RetryButton />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          label={online && !overview.stale ? t.biometricDevice.statusConnected : t.biometricDevice.statusOffline}
          value={connection.ip}
          icon={online && !overview.stale ? CircleCheck : CircleX}
          tone={online && !overview.stale ? "success" : "destructive"}
        />
        <KpiCard label={t.biometricDevice.usersOnDevice} value={online ? overview.info.userCounts : "—"} icon={Users} tone="primary" />
        <PunchedTodayCard count={online ? todayPunchedUserIds.size : null} people={todayList} />
        <KpiCard label={t.biometricDevice.logsStored} value={online ? overview.info.logCounts.toLocaleString() : "—"} icon={ListOrdered} tone="default" />
        <KpiCard label={t.biometricDevice.logCapacity} value={online ? overview.info.logCapacity.toLocaleString() : "—"} icon={HardDrive} tone="default" />
      </div>

      {!online && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-destructive">
            <span>{t.biometricDevice.deviceUnreachable}</span>
            <RetryButton />
          </CardContent>
        </Card>
      )}

      {online && (
        <Card>
          <CardContent className="p-4">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-foreground">{t.biometricDevice.usersTitle}</h2>
              <p className="text-sm text-muted-foreground">{t.biometricDevice.usersDesc}</p>
            </div>
            <DeviceUsersTable users={overview.users} employees={db.employees} punchCounts={punchCounts} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
