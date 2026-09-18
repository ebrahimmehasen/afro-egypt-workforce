import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireAccess } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { getT } from "@/lib/i18n";
import { getDeviceSnapshot, fetchDeviceAttendanceLogs } from "@/lib/zk-device";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DeviceUserDetail, DevicePunchEntry } from "@/components/biometric-device/device-user-detail";

export default async function BiometricDeviceUserPage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  await requireAccess("/biometric-device");
  const { uid } = await params;
  const t = await getT();
  const [snapshot, db] = await Promise.all([getDeviceSnapshot(), getDb()]);

  const backLink = (
    <Link href="/biometric-device" className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowRight className="h-4 w-4 rtl:rotate-180" />
      {t.biometricDevice.backToList}
    </Link>
  );

  if (!snapshot.online) {
    return (
      <div className="flex flex-col gap-6">
        {backLink}
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">
            {t.biometricDevice.deviceUnreachable} — {snapshot.error}
          </CardContent>
        </Card>
      </div>
    );
  }

  const user = snapshot.users.find((u) => String(u.uid) === uid);
  if (!user) {
    return (
      <div className="flex flex-col gap-6">
        {backLink}
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">{t.employees.noMatch}</CardContent>
        </Card>
      </div>
    );
  }

  const linkedEmployee = db.employees.find((e) => e.biometricDeviceUserId === user.userId) ?? null;
  const linkedDepartment = linkedEmployee ? db.departments.find((d) => d.id === linkedEmployee.departmentId) : null;
  const linkedShift = linkedEmployee ? db.shifts.find((s) => s.id === linkedEmployee.shiftId) : null;

  // Read straight from the device's own log, not our DB's AttendanceLog -
  // that table only has rows for device users that were linked to an
  // employee at sync time, so an unlinked (or since-relinked) device user's
  // history would show empty there even though the device itself has years
  // of punches for them (this is also what the "Total Punches" count on the
  // list page reflects, so the two need to agree). Sequential after
  // getDeviceSnapshot() above - both hold the device's one connection slot.
  const allDeviceLogs = await fetchDeviceAttendanceLogs();
  const userLogs = allDeviceLogs
    .filter((r) => r.deviceUserId === user.userId)
    .sort((a, b) => a.recordTime.getTime() - b.recordTime.getTime());
  const seenToday = new Map<string, number>();
  const history: DevicePunchEntry[] = userLogs.map((r): DevicePunchEntry => {
    const dateKey = r.recordTime.toISOString().slice(0, 10);
    const priorToday = seenToday.get(dateKey) ?? 0;
    seenToday.set(dateKey, priorToday + 1);
    return { timestamp: r.recordTime.toISOString(), punchType: priorToday === 0 ? "in" : "out" };
  }).reverse();

  return (
    <div className="flex flex-col gap-6">
      {backLink}
      <PageHeader
        title={user.name}
        description={`UID ${user.uid} · ${t.biometricDevice.deviceUserId} ${user.userId}`}
      />
      <DeviceUserDetail
        user={user}
        linkedEmployee={linkedEmployee}
        linkedDepartment={linkedDepartment ?? null}
        linkedShift={linkedShift ?? null}
        employees={db.employees}
        history={history}
      />
    </div>
  );
}
