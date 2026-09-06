import { STANDARD_ACKNOWLEDGMENT_KEYS, StandardAcknowledgmentKey } from "@/lib/types";
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
