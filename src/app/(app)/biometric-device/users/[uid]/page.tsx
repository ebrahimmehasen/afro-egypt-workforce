import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireAccess } from "@/lib/auth";
import { getDb } from "@/lib/data";
import { getT } from "@/lib/i18n";
import { getDeviceSnapshot } from "@/lib/zk-device";
import { prisma } from "@/lib/prisma";
import { toAttendanceLog } from "@/lib/serialize";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DeviceUserDetail } from "@/components/biometric-device/device-user-detail";

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

  // Keyed on the device's own userId (not the employee id) so history survives
  // an unlink/relink - it's this device user's punch history either way.
  const HISTORY_LIMIT = 100;
  const rawHistory = await prisma.attendanceLog.findMany({
    where: { deviceUserId: user.userId },
    orderBy: { timestamp: "desc" },
    take: HISTORY_LIMIT,
  });
  const historyTotal = await prisma.attendanceLog.count({ where: { deviceUserId: user.userId } });
  const history = rawHistory.map(toAttendanceLog);

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
        historyTotal={historyTotal}
        historyLimit={HISTORY_LIMIT}
      />
    </div>
  );
}
