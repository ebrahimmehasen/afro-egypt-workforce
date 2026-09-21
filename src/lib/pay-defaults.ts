import { PayBasis, PayTypeRules } from "@/lib/pay-engine";

/**
 * The starting values of the two built-in pay types — the same ones the migration seeds into the PayType
 * table. The engine never reads these while those rows exist; they are only the safety net for an employee
 * whose pay type can't be found (a row saved before pay types existed, or a database not yet migrated), so
 * their pay still calculates instead of breaking. Everything real is edited on /settings.
 */
const BASE: Omit<PayTypeRules, "id" | "code" | "name" | "basis" | "dayDivisor" | "workEnd" | "overtimeStart" | "thursdayRuleEnabled" | "thursdayWorkEnd"> = {
  hoursPerDay: null,
  workStart: "08:00",
  graceMinutes: 0,
  lateMultiplier: 1.5,
  overtimeMultiplier: 1.5,
  overtimeMinimumMinutes: 60,
  overtimeStepMinutes: 30,
  overtimeAutoApprove: true,
  permissionMultiplier: 1,
  unauthorizedExitMultiplier: 1.5,
  fridayMultiplier: 2,
  holidayMultiplier: 2,
  thursdayExtraMultiplier: 1,
  permittedAbsenceDays: 1,
  unpermittedAbsenceDays: 2,
  leaveNoticeHours: 48,
};

export const FALLBACK_PAY_TYPES: Record<PayBasis, PayTypeRules> = {
  monthly: {
    ...BASE,
    id: "paytype-monthly",
    code: "monthly",
    name: "موظف شهري",
    basis: "monthly",
    dayDivisor: 30,
    workEnd: "18:00",
    overtimeStart: "18:00",
    thursdayRuleEnabled: false,
    thursdayWorkEnd: null,
  },
  daily: {
    ...BASE,
    id: "paytype-daily",
    code: "daily",
    name: "يومية",
    basis: "daily",
    dayDivisor: 26,
    workEnd: "18:30",
    overtimeStart: "18:30",
    thursdayRuleEnabled: true,
    thursdayWorkEnd: "16:30",
  },
};

/** Used only when the settings rows are missing entirely. */
export const FALLBACK_WEEKLY_OFF_DAYS = "5";
export const FALLBACK_PAY_PERIOD_START_DAY = 26;
