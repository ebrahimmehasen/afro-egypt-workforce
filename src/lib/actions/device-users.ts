"use server";

import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { deviceUserNames } from "@/lib/device-link";
import { getDeviceOverview } from "@/lib/zk-device";

/** A short wait: the employees list is already on screen when this is asked for, so it must never hang it. */
const WAIT_MS = 4000;

/**
 * The names the fingerprint device itself holds, keyed by its own user id — for the device column
 * in the employees list. Read-only and cached (see getDeviceOverview), so calling it on every page
 * view doesn't mean a device read every time. The employees list is a client component, so it asks
 * for this after it has rendered instead of the page waiting on the hardware.
 */
export async function getDeviceUserNamesAction(): Promise<{ names: Record<string, string> } | { error: string }> {
  const user = await getSession();
  if (!user || !hasPermission(user, "employees")) return { error: "forbidden" };

  const overview = await getDeviceOverview(WAIT_MS);
  if (!overview.online) return { error: overview.error };
  return { names: deviceUserNames(overview.users) };
}
