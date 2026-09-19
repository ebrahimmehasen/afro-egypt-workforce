/**
 * Short department codes used as the prefix of Employee.employeeNumber
 * (e.g. "ACC-001"). Distinct from Department.id (a cuid) and from
 * biometricDeviceUserId. Keyed by the department's display name since
 * that's stable and human-chosen; add an entry here whenever a new
 * department is created, or DEPARTMENT_CODE will throw for it.
 */
export const DEPARTMENT_CODES: Record<string, string> = {
  "الإنتاج": "PROD",
  "المخازن": "WH",
  "الصيانة": "MNT",
  "الأمن": "SEC",
  "الموارد البشرية": "HR",
  "الحسابات": "ACC",
  "مكتب فني": "ENG",
  "المبيعات": "SALES",
  "تسويق": "MKT",
  "IT": "IT",
  "الخدمات": "SRV",
  "الدهانات": "PAINT",
  "التنجيد": "UPH",
  "التخطيط": "PLAN",
  "النقل": "TRN",
  // Holding pen for employees imported from the paper service files before HR
  // has assigned them a real department — the TBD- prefix makes them obvious.
  "غير محدد": "TBD",
};

/** Falls back to a sanitized prefix of the department name for anything not in the table above. */
export function departmentCode(departmentName: string): string {
  const known = DEPARTMENT_CODES[departmentName];
  if (known) return known;
  const ascii = departmentName.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return (ascii || "DEPT").slice(0, 6);
}
