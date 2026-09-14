"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auditActor } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { canManageBiometricDevice } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { syncDeviceAttendance } from "@/lib/attendance-sync";
import { ActionState } from "@/hooks/use-action-feedback";
import {
  cancelDeviceCapture,
  clearDeviceAttendanceLog,
  deleteDeviceFingerprint,
  deleteDeviceUser,
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
 * the role itself before touching the device or the DB.
 */
async function guard(t: Awaited<ReturnType<typeof getT>>) {
  const user = await getSession();
  if (!user || !canManageBiometricDevice(user.role)) return { error: t.validation.invalidData };
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

export async function deleteDeviceUserAction(uid: number, displayName: string) {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  try {
    await deleteDeviceUser(uid);
    await logDeviceAction(t, t.auditActions.deleteDeviceUser, displayName);
    revalidatePath(PATH);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : t.biometricDevice.deviceUnreachable };
  }
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
 * unique constraint on biometricDeviceUserId is never violated mid-swap. */
export async function linkDeviceUserAction(deviceUserId: string, employeeId: string) {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };

  try {
    await prisma.$transaction(async (tx) => {
      const conflict = await tx.employee.findFirst({
        where: { biometricDeviceUserId: deviceUserId, id: { not: employeeId }, deletedAt: null },
      });
      if (conflict) {
        await tx.employee.update({ where: { id: conflict.id }, data: { biometricDeviceUserId: null } });
      }
      await tx.employee.update({ where: { id: employeeId }, data: { biometricDeviceUserId: deviceUserId } });
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : t.biometricDevice.deviceUnreachable };
  }

  await logDeviceAction(t, t.auditActions.linkDeviceUser, `${employee.name} <- ${deviceUserId}`);
  revalidatePath(PATH);
  revalidatePath(`/employees/${employee.employeeNumber}`);
  return { success: true };
}

/** Clears the link without touching the employee record otherwise. */
export async function unlinkDeviceUserAction(deviceUserId: string) {
  const t = await getT();
  const denied = await guard(t);
  if (denied) return denied;
  const employee = await prisma.employee.findFirst({ where: { biometricDeviceUserId: deviceUserId, deletedAt: null } });
  if (!employee) return { error: t.validation.employeeNotFound };

  await prisma.employee.update({ where: { id: employee.id }, data: { biometricDeviceUserId: null } });
  await logDeviceAction(t, t.auditActions.unlinkDeviceUser, `${employee.name} (${deviceUserId})`);
  revalidatePath(PATH);
  revalidatePath(`/employees/${employee.employeeNumber}`);
  return { success: true };
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
