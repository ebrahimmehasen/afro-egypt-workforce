"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { createEmployee, updateEmployee } from "@/lib/actions/employees";
import { useActionFeedback, keepFilledFields } from "@/hooks/use-action-feedback";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { translateLabel } from "@/lib/i18n/data-labels";
import { format } from "@/lib/i18n/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Department, Employee, Shift } from "@/lib/types";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.common.saving : label}
    </Button>
  );
}

export interface PayTypeOption {
  id: string;
  code?: string | null;
  name: string;
  basis: "monthly" | "daily";
  dayDivisor: number;
  workStart: string | null;
  workEnd: string | null;
  overtimeStart: string | null;
}

export interface ScheduleOption {
  id: string;
  name: string;
}

type ScheduleMode = "schedule" | "custom" | "shift";

export function EmployeeFormDialog({
  departments,
  shifts,
  payTypes,
  schedules,
  employee,
  lenient = false,
  labeledTrigger = false,
}: {
  departments: Department[];
  shifts: Shift[];
  /** Pay types offered (the employee's own is included even if it has since been retired). */
  payTypes: PayTypeOption[];
  /** Fixed schedules offered (likewise). */
  schedules: ScheduleOption[];
  employee?: Employee;
  /** Edit trigger as a text button instead of an icon — for the profile's Actions tab. */
  labeledTrigger?: boolean;
  /** Admin editing: the browser-side format/required rules are dropped too (the server takes it as typed). */
  lenient?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  // an older employee without a pay type is on the built-in one for their pay basis
  const initialPayType =
    payTypes.find((p) => p.id === employee?.payTypeId) ??
    payTypes.find((p) => p.code === (employee?.salaryType ?? "monthly")) ??
    payTypes[0];
  const [payTypeId, setPayTypeId] = useState(initialPayType?.id ?? "");
  const payType = payTypes.find((p) => p.id === payTypeId);
  const salaryType = payType?.basis ?? employee?.salaryType ?? "monthly";
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(
    employee?.customWorkStart ? "custom" : employee?.workScheduleId ? "schedule" : employee ? "shift" : "schedule",
  );
  // custom times start from the employee's own, else the pay type's (a daily worker's day, say)
  const customDefaults =
    employee?.customWorkStart && employee.payTypeId === payTypeId
      ? { start: employee.customWorkStart, end: employee.customWorkEnd ?? "", overtime: employee.customOvertimeStart ?? "" }
      : { start: payType?.workStart ?? "", end: payType?.workEnd ?? "", overtime: payType?.overtimeStart ?? "" };

  function choosePayType(id: string) {
    setPayTypeId(id);
    const chosen = payTypes.find((p) => p.id === id);
    // a daily worker's times are set on them: open the custom times, filled from the pay type
    if (chosen?.basis === "daily" && !employee) setScheduleMode("custom");
  }

  const action = employee ? updateEmployee : createEmployee;
  const [state, formAction] = useActionState(action, {});
  useActionFeedback(state, () => setOpen(false));
  const bad = (field: string) => (state.fields?.includes(field) ? "border-destructive ring-1 ring-destructive" : "");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {employee && labeledTrigger ? (
          <Button variant="outline" className="gap-2">
            <Pencil className="h-4 w-4" />
            {t.employees.editEmployee}
          </Button>
        ) : employee ? (
          <Button variant="ghost" size="icon" aria-label={t.common.edit}>
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            {t.employees.addEmployee}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{employee ? t.employees.editEmployee : t.employees.addEmployee}</DialogTitle>
          <DialogDescription>{lenient ? t.employees.adminNoValidation : t.common.allFieldsRequired}</DialogDescription>
        </DialogHeader>
        <form action={formAction} ref={keepFilledFields} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {employee && <input type="hidden" name="id" value={employee.id} />}

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="name">{t.employees.formName}</Label>
            <Input id="name" name="name" defaultValue={employee?.name} className={bad("name")} required />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t.employees.formDepartment}</Label>
            <Select name="departmentId" defaultValue={employee?.departmentId ?? departments[0]?.id}>
              <SelectTrigger className={bad("departmentId")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{translateLabel(d.name, locale)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="jobTitle">{t.employees.formJobTitle}</Label>
            <Input id="jobTitle" name="jobTitle" defaultValue={employee?.jobTitle} className={bad("jobTitle")} required />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hireDate">{t.employees.formHireDate}</Label>
            <Input id="hireDate" name="hireDate" type="date" defaultValue={employee?.hireDate} className={bad("hireDate")} required />
          </div>

          {/* Pay type: its rules (divisor, multipliers, Thursday rule…) come from Settings. The basis it
              sets — full salary or paid days — goes along as salaryType for the older code paths. */}
          <div className="flex flex-col gap-1.5">
            <Label>{t.employees.payType}</Label>
            <Select name="payTypeId" value={payTypeId} onValueChange={choosePayType}>
              <SelectTrigger className={bad("payTypeId")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {payTypes.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="salaryType" value={salaryType} />
            {payType && <p className="text-xs text-muted-foreground">{format(t.employees.payTypeHint, { divisor: payType.dayDivisor })}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t.employees.scheduleMode}</Label>
            <Select name="scheduleMode" value={scheduleMode} onValueChange={(v) => setScheduleMode(v as ScheduleMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="schedule">{t.employees.modeSchedule}</SelectItem>
                <SelectItem value="custom">{t.employees.modeCustom}</SelectItem>
                <SelectItem value="shift">{t.employees.modeShift}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {scheduleMode === "schedule" && (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>{t.employees.workSchedule}</Label>
              <Select name="workScheduleId" defaultValue={employee?.workScheduleId ?? schedules[0]?.id}>
                <SelectTrigger className={bad("workScheduleId")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {schedules.map((s) => (
                    <SelectItem key={s.id} value={s.id}><span dir="ltr">{s.name}</span></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {scheduleMode === "custom" && (
            <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-3" key={`custom-${payTypeId}`}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customWorkStart">{t.employees.customStart}</Label>
                <Input id="customWorkStart" name="customWorkStart" type="time" defaultValue={customDefaults.start} className={bad("customWorkStart")} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customWorkEnd">{t.employees.customEnd}</Label>
                <Input id="customWorkEnd" name="customWorkEnd" type="time" defaultValue={customDefaults.end} className={bad("customWorkEnd")} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="customOvertimeStart">{t.employees.customOvertimeStart}</Label>
                <Input id="customOvertimeStart" name="customOvertimeStart" type="time" defaultValue={customDefaults.overtime} className={bad("customOvertimeStart")} />
                <p className="text-xs text-muted-foreground">{t.employees.customOvertimeHint}</p>
              </div>
            </div>
          )}

          {/* The shift stays on every employee (older records need it); it only sets the times in "by shift" mode. */}
          {scheduleMode === "shift" ? (
            <div className="flex flex-col gap-1.5">
              <Label>{t.employees.formShift}</Label>
              <Select name="shiftId" defaultValue={employee?.shiftId ?? shifts[0]?.id}>
                <SelectTrigger className={bad("shiftId")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {shifts.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{translateLabel(s.name, locale)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <input type="hidden" name="shiftId" value={employee?.shiftId ?? shifts[0]?.id ?? ""} />
          )}

          {/* Every pay type keeps the salary: a day's pay is it over the pay type's divisor. A daily worker
              may also have their own day rate, which then wins. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="basicSalary">{t.employees.formBasicSalary}</Label>
            <Input id="basicSalary" name="basicSalary" type="number" min={0} defaultValue={employee?.basicSalary} className={bad("basicSalary")} required={!lenient && salaryType === "monthly"} />
          </div>
          {salaryType === "daily" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dailyRate">{t.employees.formDailyRate}</Label>
              <Input id="dailyRate" name="dailyRate" type="number" min={0} defaultValue={employee?.dailyRate} className={bad("dailyRate")} />
              <p className="text-xs text-muted-foreground">{t.employees.dailyRateOptional}</p>
            </div>
          )}
          <input type="hidden" name="dailyWorkingHours" value={employee?.dailyWorkingHours ?? 10} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="allowances">{t.employees.formAllowances}</Label>
            <Input id="allowances" name="allowances" type="number" min={0} defaultValue={employee?.allowances ?? 0} className={bad("allowances")} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t.employees.formStatus}</Label>
            <Select name="status" defaultValue={employee?.status ?? "active"}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t.employees.statusActive}</SelectItem>
                <SelectItem value="on_leave">{t.employees.statusOnLeave}</SelectItem>
                <SelectItem value="terminated">{t.employees.statusTerminated}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mt-2 border-t border-border pt-3 sm:col-span-2">
            <p className="text-sm font-semibold text-muted-foreground">{t.employees.sectionPersonal}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nationalId">{t.employees.formNationalId}</Label>
            <Input id="nationalId" name="nationalId" dir="ltr" inputMode="numeric" pattern={lenient ? undefined : "\\d{14}"} maxLength={lenient ? undefined : 14} defaultValue={employee?.nationalId} className={bad("nationalId")} required={!lenient} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">{t.employees.formPhone}</Label>
            <Input id="phone" name="phone" dir="ltr" defaultValue={employee?.phone} className={bad("phone")} required={!lenient} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qualification">{t.employees.formQualification}</Label>
            <Input id="qualification" name="qualification" defaultValue={employee?.qualification} className={bad("qualification")} required={!lenient} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t.employees.formMilitaryStatus}</Label>
            <Select name="militaryStatus" defaultValue={employee?.militaryStatus ?? "not_applicable"}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="completed">{t.employees.militaryCompleted}</SelectItem>
                <SelectItem value="exempted">{t.employees.militaryExempted}</SelectItem>
                <SelectItem value="postponed">{t.employees.militaryPostponed}</SelectItem>
                <SelectItem value="not_applicable">{t.employees.militaryNotApplicable}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="address">{t.employees.formAddress}</Label>
            <Input id="address" name="address" defaultValue={employee?.address} className={bad("address")} required={!lenient} />
          </div>

          <DialogFooter className="sm:col-span-2">
            <SubmitButton label={employee ? t.common.save : t.employees.addEmployee} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
