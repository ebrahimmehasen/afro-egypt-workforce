import { DEMO_DATE } from "@/lib/constants";

/**
 * Demo mode. Controlled by `NEXT_PUBLIC_DEMO_MODE` so the same value is available
 * on the server and in client components (Next inlines NEXT_PUBLIC_* at build).
 *
 *   true  → "today" is frozen at DEMO_DATE, the DEMO badges / guided tour / demo
 *           logins are shown, and the database is expected to hold the full demo
 *           dataset (13 days of seeded history around Aug 2026).
 *   false → "today" is the real system clock; no demo UI; production seed.
 *
 * Defaults to false — a plain production deploy is not a demo.
 */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

/** The date the app treats as "today" (yyyy-MM-dd). */
export function today(): string {
  return DEMO_MODE ? DEMO_DATE : new Date().toISOString().slice(0, 10);
}

/** Year + 1-based month for "this month" (payroll / monthly KPIs). */
export function currentYearMonth(): { year: number; month: number } {
  const d = new Date(`${today()}T00:00:00`);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
