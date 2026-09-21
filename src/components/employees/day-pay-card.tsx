import { Bot } from "lucide-react";
import { DayPayRow } from "@/lib/day-pay-view";
import { Dictionary } from "@/lib/i18n/dictionary";
import { format, intlLocale } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/locale";
import { deductionTypeLabel, overtimeKindLabel } from "@/lib/i18n/labels";
import { formatEGP } from "@/lib/constants";
import { AttendanceStatus, DeductionType } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AttendanceStatusBadge } from "@/components/shared/status-badge";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Each day's pay as the system calculated it — in, out, hours worked, lateness, overtime and what it's worth,
 * every deduction with its reason, and the day's net — with any change a person made shown next to the
 * system's value.
 */
export function DayPayCard({
  rows,
  t,
  locale,
  payTypeName,
  times,
}: {
  rows: DayPayRow[];
  t: Dictionary;
  locale: Locale;
  payTypeName: string;
  times: { start: string; end: string; overtime: string };
}) {
  const timeFmt = (d: Date | null) => (d ? d.toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit" }) : "—");
  const hours = (minutes: number) => (minutes > 0 ? `${round2(minutes / 60)} ${t.dayPay.hoursShort}` : "—");
  const lineLabel = (type: string, direction: string) =>
    direction === "addition" ? overtimeKindLabel(type, t) : deductionTypeLabel(type as DeductionType, t);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">{t.dayPay.title}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1"><Bot className="h-3.5 w-3.5" />{t.dayPay.autoCalculated}</Badge>
          <span>{format(t.dayPay.desc, { payType: payTypeName })}</span>
          <span dir="ltr" className="text-xs">{format(t.dayPay.rulesUsed, { start: times.start, end: times.end, overtime: times.overtime })}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t.dayPay.noDays}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.dayPay.colDate}</TableHead>
                <TableHead>{t.dayPay.colIn}</TableHead>
                <TableHead>{t.dayPay.colOut}</TableHead>
                <TableHead>{t.dayPay.colWorked}</TableHead>
                <TableHead>{t.dayPay.colLate}</TableHead>
                <TableHead>{t.dayPay.colOvertime}</TableHead>
                <TableHead>{t.dayPay.colMultiplier}</TableHead>
                <TableHead>{t.dayPay.colOvertimeDue}</TableHead>
                <TableHead className="min-w-[16rem]">{t.dayPay.colDeductions} / {t.dayPay.colAdditions}</TableHead>
                <TableHead>{t.dayPay.colNet}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.date} className="align-top">
                  <TableCell className="whitespace-nowrap">
                    <div>{r.date}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.kind === "weekly_off" && <Badge variant="outline">{t.dayPay.weeklyOff}</Badge>}
                      {r.kind === "holiday" && <Badge variant="outline">{t.dayPay.holiday}</Badge>}
                      {r.kind === "workday" && r.thursday && <Badge variant="outline">{t.dayPay.thursday}</Badge>}
                      <AttendanceStatusBadge status={r.status as AttendanceStatus} />
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">{timeFmt(r.actualIn)}</TableCell>
                  <TableCell className="tabular-nums">{timeFmt(r.actualOut)}</TableCell>
                  <TableCell className="tabular-nums">{hours(r.workedMinutes)}</TableCell>
                  <TableCell className="tabular-nums">{r.lateMinutes > 0 ? `${round2(r.lateMinutes)} ${t.dayPay.minutesShort}` : "—"}</TableCell>
                  <TableCell className="tabular-nums">{hours(r.overtimeMinutes)}</TableCell>
                  <TableCell className="tabular-nums">{r.overtimeMinutes > 0 ? `× ${r.overtimeMultiplier}` : "—"}</TableCell>
                  <TableCell className="tabular-nums">{r.overtimePayHours > 0 ? `${round2(r.overtimePayHours)} ${t.dayPay.payHours}` : "—"}</TableCell>
                  <TableCell>
                    {r.actualIn && !r.actualOut && r.lines.length === 0 ? (
                      <span className="text-xs text-warning">{t.dayPay.onePunch}</span>
                    ) : r.lines.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <ul className="flex flex-col gap-1.5 text-xs">
                        {r.lines.map((l) => (
                          <li key={`${l.direction}-${l.type}`} className="flex flex-col">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className={l.direction === "addition" ? "font-semibold text-success" : "font-semibold text-destructive"}>
                                {l.direction === "addition" ? "+" : "-"}{formatEGP(l.amount, locale)}
                              </span>
                              <span className="font-medium">{lineLabel(l.type, l.direction)}</span>
                              {l.editedBy && <Badge variant="outline">{format(t.dayPay.editedBy, { name: l.editedBy })}</Badge>}
                              {l.removed && <Badge variant="outline">{t.dayPay.removedBy}</Badge>}
                              {l.pending && <Badge variant="outline">{t.dayPay.notPostedYet}</Badge>}
                            </span>
                            {l.reason && <span className="text-muted-foreground">{l.reason}</span>}
                            {(l.editedBy || l.removed) && (
                              <span className="text-muted-foreground">{format(t.dayPay.original, { value: formatEGP(l.calculated, locale) })}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                  <TableCell className={`tabular-nums font-semibold ${r.net < 0 ? "text-destructive" : r.net > 0 ? "text-success" : ""}`}>
                    {r.net === 0 ? "—" : `${r.net > 0 ? "+" : "-"}${formatEGP(Math.abs(r.net), locale)}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
