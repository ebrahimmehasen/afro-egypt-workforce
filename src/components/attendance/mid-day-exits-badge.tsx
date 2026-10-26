"use client";

import { DoorOpen } from "lucide-react";
import type { MidDayAnalysis } from "@/lib/mid-day-exits";
import { format } from "@/lib/i18n/format";
import { useT } from "@/components/providers/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const round2 = (n: number) => Math.round(n * 100) / 100;
const clock = (d: Date | string) => {
  const x = new Date(d);
  return `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
};

/** Each stretch out of the day — out, back, how long — its permission, and the minutes charged in each item. */
export function MidDayDetails({ analysis }: { analysis: MidDayAnalysis }) {
  const t = useT();
  const m = t.midDay;
  const kind = (k: "temporary" | "early_leave") => (k === "early_leave" ? t.leaves.typeEarlyLeave : t.leaves.typeTemporary);
  const permission = (p: MidDayAnalysis["intervals"][number]["permission"]) =>
    p ? format(m.permission, { duration: p.durationMinutes, start: clock(p.start), kind: kind(p.kind) }) : m.noPermission;
  const final = analysis.finalExit;
  return (
    <div className="flex flex-col gap-2 text-xs">
      {analysis.outOnPermission && <p className="font-medium text-primary">{m.outOnPermissionHint}</p>}
      {analysis.missingPunch && <p className="font-medium text-warning">{m.missingPunchHint}</p>}
      {analysis.intervals.map((i) => (
        <div key={new Date(i.out).toISOString()} className="flex flex-col gap-0.5 rounded-md border border-border p-2">
          <span className="font-medium tabular-nums">
            {format(m.exitBack, { out: clock(i.out), back: i.back ? clock(i.back) : "—", minutes: round2(i.minutes) })}
          </span>
          <span className="text-muted-foreground">{permission(i.permission)}</span>
          {!analysis.missingPunch && (
            <>
              {i.permissionMinutes > 0 && <span>{format(m.onPermission, { minutes: round2(i.permissionMinutes) })}</span>}
              {i.overrunCharged > 0 && <span className="text-destructive">{format(m.overrun, { minutes: round2(i.overrunCharged) })}</span>}
              {i.unauthorizedCharged > 0 && <span className="text-destructive">{format(m.unauthorized, { minutes: round2(i.unauthorizedCharged) })}</span>}
            </>
          )}
        </div>
      ))}
      {final && (
        <div className="flex flex-col gap-0.5 rounded-md border border-border p-2">
          <span className="font-medium tabular-nums">
            {format(final.case === 3 ? m.exitNoBack : m.leftForDay, { out: clock(final.out), minutes: round2(final.minutes) })}
          </span>
          <span className="text-muted-foreground">{permission(final.permission)}</span>
          {final.beforeCharged > 0 && <span className="text-destructive">{format(m.unauthorized, { minutes: round2(final.beforeCharged) })}</span>}
          {final.permissionMinutes > 0 && <span>{format(m.onPermission, { minutes: round2(final.permissionMinutes) })}</span>}
          {final.afterMinutes > 0 && <span className="text-destructive">{format(m.afterPermission, { minutes: round2(final.afterMinutes) })}</span>}
        </div>
      )}
      <p className="text-muted-foreground">{m.note}</p>
    </div>
  );
}

/** A small mark on a day with exits in the middle of it or a timed permission; opening it shows the details. */
export function MidDayExitsBadge({ analysis }: { analysis: MidDayAnalysis }) {
  const t = useT();
  const label = analysis.outOnPermission
    ? t.midDay.outOnPermission
    : analysis.missingPunch
      ? t.midDay.missingPunch
      : format(t.midDay.badge, { count: analysis.intervals.length + (analysis.finalExit ? 1 : 0) });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex">
          <Badge variant={analysis.missingPunch ? "warning" : "outline"} className="cursor-pointer gap-1">
            <DoorOpen className="h-3 w-3" />
            {label}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <p className="mb-2 text-sm font-semibold">{t.midDay.title}</p>
        <MidDayDetails analysis={analysis} />
      </PopoverContent>
    </Popover>
  );
}
