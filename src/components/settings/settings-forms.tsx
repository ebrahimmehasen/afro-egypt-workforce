"use client";

import { useFormState, useFormStatus } from "react-dom";
import { updateAttendanceSettings, updateCompanySettings, updatePayrollSettings } from "@/lib/actions/settings";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AttendanceSettings, CompanySettings, PayrollSettings } from "@/lib/types";

function SaveButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.common.save}</Button>;
}

export function CompanySettingsForm({ settings }: { settings: CompanySettings }) {
  const t = useT();
  const [state, formAction] = useFormState(updateCompanySettings, {});
  useActionFeedback(state);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.settings.companySettingsTitle}</CardTitle>
        <CardDescription>{t.settings.companySettingsDesc}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="companyName">{t.settings.companyName}</Label>
            <Input id="companyName" name="companyName" defaultValue={settings.companyName} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address">{t.settings.address}</Label>
            <Input id="address" name="address" defaultValue={settings.address} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">{t.settings.phone}</Label>
            <Input id="phone" name="phone" dir="ltr" defaultValue={settings.phone} required />
          </div>
          <div>
            <SaveButton />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function AttendanceSettingsForm({ settings }: { settings: AttendanceSettings }) {
  const t = useT();
  const [state, formAction] = useFormState(updateAttendanceSettings, {});
  useActionFeedback(state);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.settings.attendanceSettingsTitle}</CardTitle>
        <CardDescription>{t.settings.attendanceSettingsDesc}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="defaultGracePeriodMinutes">{t.settings.defaultGrace}</Label>
            <Input id="defaultGracePeriodMinutes" name="defaultGracePeriodMinutes" type="number" min={0} defaultValue={settings.defaultGracePeriodMinutes} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lateDeductionPerMinute">{t.settings.lateDeductionPerMinute}</Label>
            <Input id="lateDeductionPerMinute" name="lateDeductionPerMinute" type="number" min={0} defaultValue={settings.lateDeductionPerMinute} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="earlyLeaveDeductionPerMinute">{t.settings.earlyLeaveDeductionPerMinute}</Label>
            <Input id="earlyLeaveDeductionPerMinute" name="earlyLeaveDeductionPerMinute" type="number" min={0} defaultValue={settings.earlyLeaveDeductionPerMinute} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="absenceDeductionDays">{t.settings.absenceDeductionDays}</Label>
            <Input id="absenceDeductionDays" name="absenceDeductionDays" type="number" min={0} step="0.5" defaultValue={settings.absenceDeductionDays} required />
          </div>
          <div className="sm:col-span-2">
            <SaveButton />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function PayrollSettingsForm({ settings }: { settings: PayrollSettings }) {
  const t = useT();
  const [state, formAction] = useFormState(updatePayrollSettings, {});
  useActionFeedback(state);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.settings.payrollSettingsTitle}</CardTitle>
        <CardDescription>{t.settings.payrollSettingsDesc}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="overtimeHourlyMultiplier">{t.settings.overtimeMultiplier}</Label>
            <Input id="overtimeHourlyMultiplier" name="overtimeHourlyMultiplier" type="number" min={1} step="0.1" defaultValue={settings.overtimeHourlyMultiplier} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workingDaysPerMonth">{t.settings.workingDaysPerMonth}</Label>
            <Input id="workingDaysPerMonth" name="workingDaysPerMonth" type="number" min={1} defaultValue={settings.workingDaysPerMonth} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workingHoursPerDay">{t.settings.workingHoursPerDay}</Label>
            <Input id="workingHoursPerDay" name="workingHoursPerDay" type="number" min={1} defaultValue={settings.workingHoursPerDay} required />
          </div>
          <div className="sm:col-span-3">
            <SaveButton />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
