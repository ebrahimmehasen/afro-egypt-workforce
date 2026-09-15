"use client";

import { useState } from "react";
import { CalendarCheck2 } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { intlLocale } from "@/lib/i18n/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface TodayPunchEntry {
  deviceUserId: string;
  uid: number;
  name: string;
  linkedEmployeeName: string | null;
  firstPunch: string;
  lastPunch: string;
  punchCount: number;
}

export function PunchedTodayCard({ count, people }: { count: number | null; people: TodayPunchEntry[] }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const clickable = count !== null;

  const timeFmt = (iso: string) => new Date(iso).toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <Card
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={() => clickable && setOpen(true)}
        className={cn(clickable && "cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/40")}
      >
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t.biometricDevice.punchedToday}</span>
            <span className="text-2xl font-extrabold tabular-nums text-foreground">{count ?? "—"}</span>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
            <CalendarCheck2 className="h-5 w-5" />
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.biometricDevice.punchedToday}</DialogTitle>
            <DialogDescription>{t.biometricDevice.punchedTodayListDesc}</DialogDescription>
          </DialogHeader>
          {people.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t.biometricDevice.punchedTodayEmpty}</p>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.biometricDevice.name}</TableHead>
                    <TableHead>{t.biometricDevice.linkedEmployee}</TableHead>
                    <TableHead>{t.attendance.colIn}</TableHead>
                    <TableHead>{t.attendance.colOut}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {people.map((p) => (
                    <TableRow key={p.deviceUserId}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>
                        {p.linkedEmployeeName ? (
                          <Badge variant="success">{p.linkedEmployeeName}</Badge>
                        ) : (
                          <Badge variant="outline">{t.biometricDevice.notLinked}</Badge>
                        )}
                      </TableCell>
                      <TableCell dir="ltr" className="tabular-nums text-xs">{timeFmt(p.firstPunch)}</TableCell>
                      <TableCell dir="ltr" className="tabular-nums text-xs">
                        {p.punchCount > 1 ? timeFmt(p.lastPunch) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
