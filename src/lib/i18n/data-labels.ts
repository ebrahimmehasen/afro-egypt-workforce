import { Locale } from "@/lib/i18n/locale";

/**
 * Translation lookup for the fixed set of Arabic labels used in seeded demo data
 * (department names, shift names, job titles). Free-typed data — employee names,
 * leave reasons, notes — is intentionally left as entered and is not covered here.
 */
const AR_TO_EN: Record<string, string> = {
  // Departments
  "الإنتاج": "Production",
  "المخازن": "Warehouses",
  "الصيانة": "Maintenance",
  "الأمن": "Security",
  "الموارد البشرية": "Human Resources",
  "الحسابات": "Accounting",

  // Shifts
  "الوردية الصباحية": "Morning Shift",
  "الوردية المسائية": "Evening Shift",
  "الوردية الليلية": "Night Shift",

  // Job titles
  "عامل إنتاج": "Production Worker",
  "عامل خط تعبئة": "Packaging Line Worker",
  "فني تشغيل": "Operations Technician",
  "مشرف خط إنتاج": "Production Line Supervisor",
  "عامل مخزن": "Warehouse Worker",
  "أمين مخزن": "Storekeeper",
  "مراقب مخزون": "Inventory Controller",
  "عامل صيانة": "Maintenance Worker",
  "فني صيانة": "Maintenance Technician",
  "مهندس صيانة": "Maintenance Engineer",
  "فرد أمن": "Security Guard",
  "رئيس وردية أمن": "Security Shift Leader",
  "أخصائي موارد بشرية": "HR Specialist",
  "مسؤول شؤون عاملين": "Personnel Affairs Officer",
  "محاسب": "Accountant",
  "أمين صندوق": "Cashier",
  "مراجع حسابات": "Auditor",

  // Payroll periods
  "أغسطس 2026": "August 2026",
};

/** Translates a fixed data label (department/shift/job-title) when locale is English; falls back to the original text otherwise. */
export function translateLabel(text: string, locale: Locale): string {
  if (locale !== "en") return text;
  return AR_TO_EN[text] ?? text;
}
