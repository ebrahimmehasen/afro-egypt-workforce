"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auditActor } from "@/lib/audit";
import { getT } from "@/lib/i18n";
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
} from "@/lib/zk-device";

const PATH = "/biometric-device";

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

export async function updateDeviceConnection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const t = await getT();
  const parsed = connectionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.validation.invalidData };
  await saveDeviceConnection(parsed.data);
  await logDeviceAction(t, t.auditActions.editDeviceConnection, `${parsed.data.ip}:${parsed.data.port}`);
  revalidatePath(PATH);
  return { success: true, message: t.biometricDevice.connectionSaved };
}

export async function deleteDeviceUserAction(uid: number, displayName: string) {
  const t = await getT();
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
  try {
    await cancelDeviceCapture();
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : t.biometricDevice.deviceUnreachable };
  }
}

export async function restartDeviceAction() {
  const t = await getT();
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
  try {
    await setDeviceEnabled(enabled);
    await logDeviceAction(t, enabled ? t.auditActions.enableDevice : t.auditActions.disableDevice, "-");
    revalidatePath(PATH);
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : t.biometricDevice.deviceUnreachable };
  }
}

/** Wipes the device's own log buffer permanently — gated by a typed confirmation phrase, checked here too (not just in the UI). */
export async function clearDeviceLogAction(confirmText: string) {
  const t = await getT();
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
