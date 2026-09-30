import { EmployeeAcknowledgment, STANDARD_ACKNOWLEDGMENT_KEYS, StandardAcknowledgmentKey } from "@/lib/types";
import type { Dictionary } from "@/lib/i18n/dictionary";

export { STANDARD_ACKNOWLEDGMENT_KEYS };

export function isStandardAcknowledgmentKey(key: string): key is StandardAcknowledgmentKey {
  return (STANDARD_ACKNOWLEDGMENT_KEYS as readonly string[]).includes(key);
}

export function isCustomAcknowledgmentKey(key: string): boolean {
  return key.startsWith("custom-");
}

/** The fixed display label for a standard slot. */
export function standardAcknowledgmentLabel(key: StandardAcknowledgmentKey, t: Dictionary): string {
  return t.acknowledgments.slots[key];
}

/**
 * "المستوى الثاني" — the signatures every employee must have on file: proof of address, the
 * employment contract, the work-receipt acknowledgment and the internal bylaws. `custody_receipt`
 * and `confidentiality` are additional/legacy — never required by default.
 */
export const CORE_REQUIRED_ACKNOWLEDGMENT_KEYS: StandardAcknowledgmentKey[] = [
  "address_confirmation",
  "employment_terms",
  "work_receipt",
  "internal_bylaws",
];

/** "Other" (a custom slot) is never part of the company checklist, only the fixed slots are. */
export function canAcknowledgmentBeRequired(key: string): key is StandardAcknowledgmentKey {
  return isStandardAcknowledgmentKey(key);
}

type AckEmployee = { isDriver?: boolean };

/** This employee's own default required-acknowledgment list: the core four, plus the vehicle
 * receipt for a driver. */
export function defaultRequiredAcknowledgmentKeys(employee: AckEmployee): StandardAcknowledgmentKey[] {
  return [...CORE_REQUIRED_ACKNOWLEDGMENT_KEYS, ...(employee.isDriver ? (["vehicle_receipt"] as const) : [])];
}

/** Reads the stored JSON, keeping only known, requirable keys. `undefined` = the company default. */
export function parseRequiredAcknowledgments(raw: unknown): StandardAcknowledgmentKey[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return STANDARD_ACKNOWLEDGMENT_KEYS.filter((k) => raw.includes(k));
}

/** The acknowledgment keys this employee must have signed — their own list, otherwise their computed default. */
export function requiredAcknowledgmentKeys(
  employee: AckEmployee & { requiredAcknowledgments?: StandardAcknowledgmentKey[] },
): StandardAcknowledgmentKey[] {
  return employee.requiredAcknowledgments ?? defaultRequiredAcknowledgmentKeys(employee);
}

/** Same idea as `withRequirement` in @/lib/documents, for acknowledgments. */
export function withAcknowledgmentRequirement(
  current: StandardAcknowledgmentKey[],
  key: StandardAcknowledgmentKey,
  required: boolean,
  defaults: StandardAcknowledgmentKey[],
): StandardAcknowledgmentKey[] | null {
  const set = new Set(current);
  if (required) set.add(key);
  else set.delete(key);
  const isDefault = set.size === defaults.length && defaults.every((k) => set.has(k));
  return isDefault ? null : STANDARD_ACKNOWLEDGMENT_KEYS.filter((k) => set.has(k));
}

/** Required keys nothing is signed for yet. */
export function missingAcknowledgmentKeys(
  acks: EmployeeAcknowledgment[],
  required: StandardAcknowledgmentKey[],
): StandardAcknowledgmentKey[] {
  const present = new Set(acks.map((a) => a.key));
  return required.filter((k) => !present.has(k));
}

export function acknowledgmentsComplete(acks: EmployeeAcknowledgment[], required: StandardAcknowledgmentKey[]): boolean {
  return missingAcknowledgmentKeys(acks, required).length === 0;
}
