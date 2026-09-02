import { Locale } from "@/lib/i18n/locale";

export const COMPANY = {
  name: "Afro Egypt",
  productName: "Factory Workforce",
  developer: "404 Legends",
  slogan: "Where 404 Becomes Legend.",
  logo: "/brand/afro-egypt-logo.jpg",
} as const;

export const DEMO_DATE = "2026-08-21"; // fixed demo "today"
export const DEMO_EMPLOYEE_ID = "EMP-1001";
export const DEMO_PERIOD_ID = "PP-2026-08";

export const DEPARTMENT_NAMES = [
  "الإنتاج",
  "المخازن",
  "الصيانة",
  "الأمن",
  "الموارد البشرية",
  "الحسابات",
] as const;

export const ATTENDANCE_STATUS_VARIANT: Record<
  import("@/lib/types").AttendanceStatus,
  "success" | "warning" | "destructive" | "secondary" | "outline" | "default"
> = {
  present: "success",
  late: "warning",
  absent: "destructive",
  leave: "secondary",
  mission: "outline",
  excused_absence: "secondary",
  early_leave: "warning",
  missing_punch: "destructive",
};

export const REQUEST_STATUS_VARIANT: Record<
  import("@/lib/types").RequestStatus,
  "success" | "warning" | "destructive"
> = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
};

const EGP_FORMATTERS: Record<Locale, Intl.NumberFormat> = {
  ar: new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 0 }),
  en: new Intl.NumberFormat("en-US", { style: "currency", currency: "EGP", maximumFractionDigits: 0 }),
};

export function formatEGP(value: number, locale: Locale = "ar") {
  return EGP_FORMATTERS[locale].format(Math.round(value));
}
