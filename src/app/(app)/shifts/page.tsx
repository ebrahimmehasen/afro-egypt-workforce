import { getDb } from "@/lib/data";
import { requireSession } from "@/lib/auth";
import { canManageSettings } from "@/lib/permissions";
import { getT } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/locale";
import { translateLabel } from "@/lib/i18n/data-labels";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShiftFormDialog } from "@/components/shifts/shift-form-dialog";
import { Clock } from "lucide-react";

export default async function ShiftsPage() {
  const db = await getDb();
  const user = await requireSession();
  const t = await getT();
  const locale = await getLocale();
  const canEdit = canManageSettings(user.role) || user.role === "hr";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.shifts.title}
        description={t.shifts.description}
        actions={canEdit ? <ShiftFormDialog /> : null}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {db.shifts.map((shift) => {
          const employeeCount = db.employees.filter((e) => e.shiftId === shift.id).length;
          return (
            <Card key={shift.id}>
              <CardContent className="flex flex-col gap-4 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold-400/20 text-gold-700">
                      <Clock className="h-4 w-4" />
                    </div>
                    <p className="font-semibold text-foreground">{translateLabel(shift.name, locale)}</p>
                  </div>
                  {canEdit && <ShiftFormDialog shift={shift} />}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t.shifts.workHours}</span>
                  <span dir="ltr" className="font-mono font-medium">{shift.startTime} → {shift.endTime}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t.shifts.gracePeriod}</span>
                  <span className="font-medium">{shift.gracePeriodMinutes} {t.common.minutes}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t.shifts.employeeCount}</span>
                  <span className="font-medium">{employeeCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t.nav.overtime}</span>
                  <Badge variant={shift.allowOvertime ? "success" : "secondary"}>
                    {shift.allowOvertime ? t.shifts.overtimeAllowed : t.shifts.overtimeNotAllowed}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
