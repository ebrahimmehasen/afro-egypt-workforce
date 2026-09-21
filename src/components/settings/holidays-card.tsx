"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { CalendarOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { addHoliday, deleteHoliday } from "@/lib/actions/holidays";
import { keepFilledFields, useActionFeedback } from "@/hooks/use-action-feedback";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { format, intlLocale } from "@/lib/i18n/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export interface HolidayRow {
  id: string;
  name: string;
  from: string;
  to: string;
}

function AddButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.holidays.adding : t.holidays.add}</Button>;
}

function DeleteHolidayButton({ holiday }: { holiday: HolidayRow }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t.common.delete} className="text-destructive hover:text-destructive" disabled={pending}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.holidays.deleteTitle}</AlertDialogTitle>
          <AlertDialogDescription>{format(t.holidays.deleteConfirm, { name: holiday.name })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await deleteHoliday(holiday.id);
                if (res.error) toast.error(res.error);
                else toast.success(res.message ?? t.holidays.deleted);
              })
            }
          >
            {t.common.delete}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The factory's public holidays: add a named day or range, see them all, remove one. */
export function HolidaysCard({ holidays, today }: { holidays: HolidayRow[]; today: string }) {
  const t = useT();
  const locale = useLocale();
  const [state, formAction] = useActionState(addHoliday, {});
  // a fresh, empty form after each successful add; after an error the typed values stay
  const [formKey, setFormKey] = useState(0);
  useActionFeedback(state, () => setFormKey((k) => k + 1));

  const dayFmt = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const show = (day: string) => dayFmt.format(new Date(`${day}T00:00:00Z`));
  const length = (h: HolidayRow) => Math.round((Date.parse(`${h.to}T00:00:00Z`) - Date.parse(`${h.from}T00:00:00Z`)) / 86_400_000) + 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarOff className="h-5 w-5 text-primary" />
          {t.holidays.title}
        </CardTitle>
        <CardDescription>{t.holidays.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form key={formKey} ref={keepFilledFields} action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="holiday-name">{t.holidays.name}</Label>
            <Input id="holiday-name" name="name" placeholder={t.holidays.namePlaceholder} required minLength={2} maxLength={100} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="holiday-from">{t.holidays.from}</Label>
            <Input id="holiday-from" name="from" type="date" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="holiday-to">{t.holidays.to}</Label>
            <Input id="holiday-to" name="to" type="date" title={t.holidays.toHint} />
          </div>
          <AddButton />
          <p className="text-xs text-muted-foreground sm:col-span-4">{t.holidays.toHint}</p>
        </form>

        {holidays.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t.holidays.empty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {holidays.map((h) => {
              const days = length(h);
              const past = h.to < today;
              return (
                <li key={h.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${past ? "opacity-60" : ""}`}>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      <span className="truncate">{h.name}</span>
                      <Badge variant="secondary">{days === 1 ? t.holidays.oneDay : format(t.holidays.days, { count: days })}</Badge>
                      {past && <Badge variant="outline">{t.holidays.past}</Badge>}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {show(h.from)}
                      {days > 1 && <> {locale === "ar" ? " ← " : " → "} {show(h.to)}</>}
                    </p>
                  </div>
                  <DeleteHolidayButton holiday={h} />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
