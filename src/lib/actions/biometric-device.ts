"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auditActor, recordChangeAs } from "@/lib/audit";
import { gate } from "@/lib/change-requests";
import { canLinkDeviceEmployee } from "@/lib/scope";
import { getSession } from "@/lib/auth";
import { canUseBiometricDevice } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { syncDeviceAttendance, backfillDeviceUser } from "@/lib/attendance-sync";
import { removeDeviceUserAttendance } from "@/lib/attendance-ingest";
import { attendanceRealtimeStatus, pauseAttendanceRealtime, resumeAttendanceRealtime } from "@/lib/attendance-realtime";
import { ActionState } from "@/hooks/use-action-feedback";
import {
  cancelDeviceCapture,
  clearDeviceAttendanceLog,
  deleteDeviceFingerprint,
  deleteDeviceUser,
  invalidateDeviceOverview,
  restartDevice,
  saveDeviceConnection,
  setDeviceEnabled,
  startDeviceEnroll,
  testDeviceConnection,
  updateDeviceUserName,
} from "@/lib/zk-device";

const PATH = "/biometric-device";

/**
 * Server Actions are directly callable HTTP endpoints regardless of what the
 * UI shows — the page's requireAccess() check alone doesn't stop a request
 * crafted straight at one of these, so every exported action here re-checks
 * the "جهاز البصمة" permission itself (admin, or an account granted it)
 * before touching the device or the DB.
 */
async function guard(t: Awaited<ReturnType<typeof getT>>) {
  const user = await getSession();
  if (!user || !canUseBiometricDevice(user)) return { error: t.validation.invalidData };
  return null;
}

/** Every device action logs its own audit row directly — there's no Prisma write to
 * bundle it with (the mutation happens on the hardware, not in our database), so
 * `recordChange`'s single-transaction guarantee doesn't apply here. */
async function logDeviceAction(t: Awaited<ReturnType<typeof getT>>, action: string, detail: string) {
  const userName = await auditActor();
  await prisma.auditLogEntry.create({
    data: { userName, module: t.nav.biometricDevice, action, oldValue: "-", newValue: detail },
  });
}

const connectionSchema = z.object({
  ip: z.string().min(3),
  port: z.coerce.number().int().min(1).max(65535),
  commPassword: z.coerce.number().int().min(0).default(0),
});

/** Tests connectivity with the (possibly unsaved) form values, without writing anything. */
export async function testDeviceConnectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  const parsed = connectionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };

  const result = await testDeviceConnection(parsed.data);
  if (!result.ok) return { error: `${t.biometricDevice.testConnectionFailed} — ${result.error}` };
  return { success: true, message: t.biometricDevice.testConnectionOk };
}

export async function updateDeviceConnection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  const parsed = connectionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  await saveDeviceConnection(parsed.data);
  await logDeviceAction(t, t.auditActions.editDeviceConnection, `${parsed.data.ip}:${parsed.data.port}`);
  revalidatePath(PATH);
  return { success: true, message: t.biometricDevice.connectionSaved };
}

/** Deleting the person from the device entirely also clears any employee link to
 * them (same cleanup as unlinkDeviceUserAction) — otherwise the employee is stuck
 * "linked" to a device user id the device no longer has, which blocks them from
 * ever showing up to be linked to a re-enrollment of the same person later. */
export async function deleteDeviceUserAction(uid: number, userId: string, displayName: string) {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  // The device user may be linked to an employee, and deleting it removes that link and the attendance behind it,
  // so a scoped account can only do it for an employee inside its scope (checked before the device is touched).
  const employee = await prisma.employee.findFirst({ where: { biometricDeviceUserId: userId, deletedAt: null } });
  const actor = await getSession();
  if (employee && !(actor && (await canLinkDeviceEmployee(actor, employee.id)))) return { error: t.validation.notAllowed };
  try {
    await deleteDeviceUser(uid);
  } catch (e) {
    return { error: e instanceof Error ? e.message : t.biometricDevice.deviceUnreachable };
  }

  let detail = displayName;
  if (employee) {
    const { deleted } = await removeDeviceUserAttendance(employee.id, userId);
    await prisma.employee.update({ where: { id: employee.id }, data: { biometricDeviceUserId: null, biometricLinkedAt: null } });
    detail = `${displayName} (${employee.name}) — ${deleted} ${t.biometricDevice.recordsRemoved}`;
  }

  await logDeviceAction(t, t.auditActions.deleteDeviceUser, detail);
  revalidatePath(PATH);
  if (employee) {
    revalidatePath("/employees");
    revalidatePath(`/employees/${employee.employeeNumber}`);
    revalidatePath("/attendance");
    revalidatePath("/dashboard");
  }
  return { success: true };
}

export async function deleteDeviceFingerprintAction(uid: number, fingerIndex: number, displayName: string) {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  try {
    await deleteDeviceFingerprint(uid, fingerIndex);
    await logDeviceAction(t, t.auditActions.deleteDeviceFingerprint, `${displayName} — ${t.biometricDevice.finger} ${fingerIndex}`);
    revalidatePath(PATH);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : t.biometricDevice.deviceUnreachable };
  }
}

export async function startDeviceEnrollAction(uid: number, fingerIndex: number, displayName: string) {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  try {
    await startDeviceEnroll(uid, fingerIndex);
    await logDeviceAction(t, t.auditActions.startDeviceEnroll, `${displayName} — ${t.biometricDevice.finger} ${fingerIndex}`);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : t.biometricDevice.deviceUnreachable };
  }
}

export async function cancelDeviceCaptureAction() {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  try {
    await cancelDeviceCapture();
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : t.biometricDevice.deviceUnreachable };
  }
}

export async function restartDeviceAction() {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  try {
    await restartDevice();
    await logDeviceAction(t, t.auditActions.restartDevice, "-");
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : t.biometricDevice.deviceUnreachable };
  }
}

export async function setDeviceEnabledAction(enabled: boolean) {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  try {
    await setDeviceEnabled(enabled);
    await logDeviceAction(t, enabled ? t.auditActions.enableDevice : t.auditActions.disableDevice, "-");
    revalidatePath(PATH);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : t.biometricDevice.deviceUnreachable };
  }
}

/** Renames a user on the device itself (not just in our DB — there's nothing of
 * this in our DB to begin with, the name lives entirely on the hardware). */
export async function updateDeviceUserNameAction(uid: number, newName: string, oldName: string) {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  const trimmed = newName.trim();
  if (!trimmed) return { error: t.validation.invalidData };
  try {
    await updateDeviceUserName(uid, trimmed);
  } catch (e) {
    return { error: e instanceof Error ? e.message : t.biometricDevice.deviceUnreachable };
  }
  await logDeviceAction(t, t.auditActions.renameDeviceUser, `${oldName} -> ${trimmed}`);
  revalidatePath(PATH);
  return { success: true };
}

/** Links a device user to an employee. If the device user was already linked to a
 * different employee, that link is cleared first (in the same transaction) so the
 * unique constraint on biometricDeviceUserId is never violated mid-swap.
 *
 * Changing an employee's link is an ordinary edit of their record: it goes through gate() (an admin or a
 * directEdit account applies it now, anyone else's request waits for the admin), and a scoped account may
 * only touch employees inside its scope - checked here on the server, for the employee being linked and for
 * the one it would be taken from. */
export async function linkDeviceUserAction(deviceUserId: string, employeeId: string): Promise<ActionState & { imported?: number }> {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  const actor = await getSession();
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };
  const current = await prisma.employee.findFirst({
    where: { biometricDeviceUserId: deviceUserId, id: { not: employeeId }, deletedAt: null },
    select: { id: true },
  });
  if (!actor || !(await canLinkDeviceEmployee(actor, employeeId)) || (current && !(await canLinkDeviceEmployee(actor, current.id)))) {
    return { error: t.validation.notAllowed };
  }

  return gate(
    {
      actionKey: "biometric.link",
      module: t.nav.biometricDevice,
      actionLabel: t.auditActions.linkDeviceUser,
      summary: `${employee.name} (${employee.employeeNumber}) <- ${deviceUserId}`,
      targetId: employeeId,
    },
    { deviceUserId, employeeId },
    () => applyLinkDeviceUser({ deviceUserId, employeeId }, actor.name),
  );
}

export async function applyLinkDeviceUser(
  payload: { deviceUserId: string; employeeId: string },
  actorName: string,
): Promise<ActionState & { imported?: number }> {
  const t = await getT();
  const { deviceUserId, employeeId } = payload;
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };

  try {
    await recordChangeAs(
      actorName,
      {
        module: t.nav.biometricDevice,
        action: t.auditActions.linkDeviceUser,
        oldValue: employee.biometricDeviceUserId ?? "-",
        newValue: deviceUserId,
        reason: `${employee.name} (${employee.employeeNumber})`,
      },
      async (tx) => {
        const conflict = await tx.employee.findFirst({
          where: { biometricDeviceUserId: deviceUserId, id: { not: employeeId }, deletedAt: null },
        });
        if (conflict) {
          await tx.employee.update({ where: { id: conflict.id }, data: { biometricDeviceUserId: null, biometricLinkedAt: null } });
        }
        await tx.employee.update({
          where: { id: employeeId },
          // a re-link to the same device user keeps its original date
          data: { biometricDeviceUserId: deviceUserId, ...(employee.biometricDeviceUserId === deviceUserId ? {} : { biometricLinkedAt: new Date() }) },
        });
      },
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : t.biometricDevice.deviceUnreachable };
  }

  // Linking means "this person's whole device history is now theirs" - back
  // it all in immediately rather than waiting for the next real-time punch
  // or safety-net poll to happen to notice the link exists.
  let imported = 0;
  try {
    ({ imported } = await backfillDeviceUser(deviceUserId));
  } catch (e) {
    // The link itself already succeeded; a failed backfill just means the
    // history will catch up on the next sync instead of right now.
    console.error("[biometric-device] backfill after link failed:", e instanceof Error ? e.message : e);
  }

  revalidatePath(PATH);
  revalidatePath(`/employees/${employee.employeeNumber}`);
  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  return { success: true, imported };
}

/** Clears the link AND removes the attendance this employee only has because
 * of it (source: "biometric" rows tied to this deviceUserId) - an unlink
 * means "this wasn't actually them", so their record shouldn't keep saying
 * otherwise. Manual HR corrections are untouched (they're not stored as
 * AttendanceLog rows at all). Same gate() and scope rules as linking.
 * (Ending an employee's service clears the link differently - see
 * deviceLinkClearOnTermination - and keeps their attendance.) */
export async function unlinkDeviceUserAction(deviceUserId: string): Promise<ActionState & { deleted?: number }> {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  const actor = await getSession();
  const employee = await prisma.employee.findFirst({ where: { biometricDeviceUserId: deviceUserId, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };
  if (!actor || !(await canLinkDeviceEmployee(actor, employee.id))) return { error: t.validation.notAllowed };

  return gate(
    {
      actionKey: "biometric.unlink",
      module: t.nav.biometricDevice,
      actionLabel: t.auditActions.unlinkDeviceUser,
      summary: `${employee.name} (${employee.employeeNumber}) - ${deviceUserId}`,
      targetId: employee.id,
    },
    { deviceUserId },
    () => applyUnlinkDeviceUser({ deviceUserId }, actor.name),
  );
}

export async function applyUnlinkDeviceUser(
  payload: { deviceUserId: string },
  actorName: string,
): Promise<ActionState & { deleted?: number }> {
  const t = await getT();
  const { deviceUserId } = payload;
  const employee = await prisma.employee.findFirst({ where: { biometricDeviceUserId: deviceUserId, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };

  const { deleted } = await removeDeviceUserAttendance(employee.id, deviceUserId);
  await recordChangeAs(
    actorName,
    {
      module: t.nav.biometricDevice,
      action: t.auditActions.unlinkDeviceUser,
      oldValue: deviceUserId,
      newValue: "-",
      reason: `${employee.name} (${employee.employeeNumber}) - ${deleted} ${t.biometricDevice.recordsRemoved}`,
    },
    (tx) => tx.employee.update({ where: { id: employee.id }, data: { biometricDeviceUserId: null, biometricLinkedAt: null } }),
  );
  revalidatePath(PATH);
  revalidatePath("/employees");
  revalidatePath(`/employees/${employee.employeeNumber}`);
  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  return { success: true, deleted };
}

/** Wipes the device's own log buffer permanently — gated by a typed confirmation phrase, checked here too (not just in the UI). */
export async function clearDeviceLogAction(confirmText: string) {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  if (confirmText.trim() !== t.biometricDevice.clearLogConfirmWord) {
    return { error: t.validation.invalidData };
  }
  try {
    await clearDeviceAttendanceLog();
    await logDeviceAction(t, t.auditActions.clearDeviceLog, "-");
    revalidatePath(PATH);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : t.biometricDevice.deviceUnreachable };
  }
}

/**
 * Pulls whatever punches are sitting in the device's log into AttendanceLog.
 * There is no automatic ingestion path otherwise: /api/punch only receives
 * anything if the device itself is configured to push to it (a device-side
 * ADMS/cloud-server setting this project never set up), so without this
 * button a real punch on the device never reaches the app no matter how
 * many times someone scans their finger.
 */
/** Cheap poll for the status badge — reads in-memory state only, never touches the device. */
export async function getRealtimeStatusAction() {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  return { success: true as const, status: attendanceRealtimeStatus() };
}

/** "Retry / refresh" on the device data — drops the cached copy so the page reads from the device again. */
export async function refreshDeviceDataAction() {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  invalidateDeviceOverview();
  revalidatePath(PATH);
  return { success: true as const };
}

export async function syncAttendanceNowAction() {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  try {
    const result = await syncDeviceAttendance();
    await logDeviceAction(
      t,
      t.auditActions.syncAttendance,
      `${t.biometricDevice.syncImported}: ${result.imported}, ${t.biometricDevice.syncUnlinked}: ${result.skippedUnlinked}`,
    );
    revalidatePath("/attendance");
    revalidatePath("/dashboard");
    return { success: true, result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : t.biometricDevice.deviceUnreachable };
  }
}

/** Manual "Pause" — releases the device so an admin can safely spend time at
 * the device's own physical menu (enrolling someone, etc.) without the
 * real-time listener fighting for the connection. */
export async function pauseRealtimeSyncAction() {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  try {
    await pauseAttendanceRealtime();
    await logDeviceAction(t, t.auditActions.pauseRealtimeSync, "-");
    revalidatePath(PATH);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : t.biometricDevice.deviceUnreachable };
  }
}

/** Manual "Resume" — catches up on anything that happened while paused,
 * then restarts real-time listening. */
export async function resumeRealtimeSyncAction() {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  try {
    await resumeAttendanceRealtime();
    await logDeviceAction(t, t.auditActions.resumeRealtimeSync, "-");
    revalidatePath(PATH);
    revalidatePath("/attendance");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : t.biometricDevice.deviceUnreachable };
  }
}
