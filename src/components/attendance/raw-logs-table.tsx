"use client";

import { AttendanceLog, Employee } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { Lock } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { intlLocale } from "@/lib/i18n/format";

export function RawLogsTable({ logs, employees }: { logs: AttendanceLog[]; employees: Employee[] }) {
  const t = useT();
  const locale = useLocale();
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const sorted = [...logs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (sorted.length === 0) {
    return <EmptyState icon={Lock} title={t.attendance.noRawLogs} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.common.employee}</TableHead>
            <TableHead>{t.attendance.rawColDevice}</TableHead>
            <TableHead>{t.attendance.rawColTimestamp}</TableHead>
            <TableHead>{t.attendance.rawColType}</TableHead>
            <TableHead>{t.attendance.rawColSource}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((log) => (
            <TableRow key={log.id}>
              <TableCell>
                <div className="font-medium">{empMap.get(log.employeeId)?.name ?? log.employeeId}</div>
                <div className="text-xs text-muted-foreground">{log.employeeId}</div>
              </TableCell>
              <TableCell dir="ltr" className="font-mono text-xs">{log.deviceId}</TableCell>
              <TableCell dir="ltr" className="tabular-nums text-xs">
                {new Date(log.timestamp).toLocaleString(intlLocale(locale))}
              </TableCell>
              <TableCell>
                <Badge variant={log.punchType === "in" ? "success" : "secondary"}>
                  {log.punchType === "in" ? t.attendance.punchIn : t.attendance.punchOut}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {log.source === "simulated" ? t.attendance.sourceSimulated : t.attendance.sourceManual}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
