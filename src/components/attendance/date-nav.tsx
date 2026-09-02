"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale, useT } from "@/components/providers/locale-provider";

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function DateNav({ date }: { date: string }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();

  function go(newDate: string) {
    router.push(`/attendance?date=${newDate}`);
  }

  const Prev = locale === "ar" ? ChevronRight : ChevronLeft;
  const Next = locale === "ar" ? ChevronLeft : ChevronRight;

  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon" onClick={() => go(shiftDate(date, -1))} aria-label={t.attendance.prevDay}>
        <Prev className="h-4 w-4" />
      </Button>
      <Input
        type="date"
        value={date}
        onChange={(e) => go(e.target.value)}
        className="w-40"
      />
      <Button variant="outline" size="icon" onClick={() => go(shiftDate(date, 1))} aria-label={t.attendance.nextDay}>
        <Next className="h-4 w-4" />
      </Button>
    </div>
  );
}
