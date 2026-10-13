"use client";

import { useT } from "@/components/providers/locale-provider";
import { format } from "@/lib/i18n/format";
import type { LeaveBalance } from "@/lib/leave-balance";
import { cn } from "@/lib/utils";

/** Quarter-day balances read as 1.75 / 3.5 / 2: no trailing zeros. */
const fmtDays = (n: number) => String(Math.round(n * 100) / 100);

/**
 * The annual-leave balance of one employee: what can be requested right now (the whole days of the balance),
 * what has accrued this year, and what is used or reserved (approved plus pending). Presentation only — the
 * numbers come from leave-balance.ts, and the server re-checks every request itself.
 */
export function LeaveBalanceCard({ balance, className }: { balance: LeaveBalance; className?: string }) {
  const t = useT();
  const b = t.leaves.balance;

  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3", className)}>
      <p className="text-xs font-semibold text-foreground">
        {b.title} <span className="font-normal text-muted-foreground">({balance.year})</span>
      </p>
      {balance.eligible ? (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <Stat label={b.available} value={balance.availableDays} unit={b.daysUnit} strong />
            <Stat label={b.accrued} value={balance.accruedDays} unit={b.daysUnit} />
            <Stat label={b.used} value={balance.usedDays} unit={b.daysUnit} />
          </dl>
          <p className="text-[11px] text-muted-foreground">{b.fractionHint}</p>
        </>
      ) : (
        <p className="text-xs text-warning">{format(b.notEligible, { date: balance.eligibleOn })}</p>
      )}
    </div>
  );
}

function Stat({ label, value, unit, strong = false }: { label: string; value: number; unit: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-background p-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "text-lg font-extrabold text-primary" : "text-sm font-semibold")}>
        {fmtDays(value)} <span className="text-[10px] font-normal text-muted-foreground">{unit}</span>
      </dd>
    </div>
  );
}
