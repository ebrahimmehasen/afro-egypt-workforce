// What the employees list shows in the "fingerprint device" column. Pure, so the decision is
// testable without the hardware: the device's own user names are read separately (and may not
// have arrived, or the device may be unreachable), while the link itself comes from our database.

export type DeviceLink =
  /** No device user linked to this employee at all. */
  | { state: "not_linked" }
  /** Linked, but we can't say what the device calls them right now (names not loaded / device down / blank name). */
  | { state: "unknown"; deviceUserId: string }
  /** Linked, and this is the name the device itself holds. */
  | { state: "named"; deviceUserId: string; name: string }
  /** Linked to a device user that the device no longer has — the record was deleted on the device. */
  | { state: "missing"; deviceUserId: string };

/**
 * @param deviceUserId the employee's linked device user id, from our own records
 * @param names the device's users keyed by that same id, or null while they aren't available
 */
export function deviceLink(deviceUserId: string | null | undefined, names: Record<string, string> | null): DeviceLink {
  const id = deviceUserId?.trim();
  if (!id) return { state: "not_linked" };
  if (!names) return { state: "unknown", deviceUserId: id };
  const name = names[id];
  if (name === undefined) return { state: "missing", deviceUserId: id };
  const trimmed = name.trim();
  return trimmed ? { state: "named", deviceUserId: id, name: trimmed } : { state: "unknown", deviceUserId: id };
}

/** The device's users as a plain id → name map. */
export function deviceUserNames(users: { userId: string; name: string }[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const u of users) names[u.userId] = u.name;
  return names;
}
