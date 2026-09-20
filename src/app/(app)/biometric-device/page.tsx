import { Suspense } from "react";
import { requireAccess } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getDeviceConnection } from "@/lib/zk-device";
import { attendanceRealtimeStatus } from "@/lib/attendance-realtime";
import { PageHeader } from "@/components/shared/page-header";
import { DeviceConnectionForm } from "@/components/biometric-device/connection-form";
import { DeviceActions } from "@/components/biometric-device/device-actions";
import { SyncAttendanceCard } from "@/components/biometric-device/sync-attendance-card";
import { DeviceDataFallback, DeviceDataSection } from "@/components/biometric-device/device-data-section";

export default async function BiometricDevicePage() {
  await requireAccess("/biometric-device");

  const t = await getT();
  // Only the saved connection settings (a database read) are needed to draw the page. Everything that
  // has to ask the device itself is streamed in below, with a time limit, so a device that is off,
  // restarting or slow can never leave this page stuck loading.
  const connection = await getDeviceConnection();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.biometricDevice.title} description={t.biometricDevice.description} />

      <SyncAttendanceCard initialStatus={attendanceRealtimeStatus()} />

      <Suspense fallback={<DeviceDataFallback />}>
        <DeviceDataSection />
      </Suspense>

      <DeviceConnectionForm connection={connection} />
      <DeviceActions />
    </div>
  );
}
