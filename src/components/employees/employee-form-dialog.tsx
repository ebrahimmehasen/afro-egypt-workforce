"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { createEmployee, updateEmployee } from "@/lib/actions/employees";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { translateLabel } from "@/lib/i18n/data-labels";
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

export function EmployeeFormDialog({
  departments,
  shifts,
  employee,
}: {
  departments: Department[];
  shifts: Shift[];
  employee?: Employee;
}) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [salaryType, setSalaryType] = useState<"monthly" | "daily">(employee?.salaryType ?? "monthly");
  const action = employee ? updateEmployee : createEmployee;
  const [state, formAction] = useActionState(action, {});
  useActionFeedback(state, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {employee ? (
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{employee ? t.employees.editEmployee : t.employees.addEmployee}</DialogTitle>
          <DialogDescription>{t.common.allFieldsRequired}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {employee && <input type="hidden" name="id" value={employee.id} />}

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="name">{t.employees.formName}</Label>
            <Input id="name" name="name" defaultValue={employee?.name} required />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t.employees.formDepartment}</Label>
            <Select name="departmentId" defaultValue={employee?.departmentId ?? departments[0]?.id}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{translateLabel(d.name, locale)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="jobTitle">{t.employees.formJobTitle}</Label>
            <Input id="jobTitle" name="jobTitle" defaultValue={employee?.jobTitle} required />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hireDate">{t.employees.formHireDate}</Label>
            <Input id="hireDate" name="hireDate" type="date" defaultValue={employee?.hireDate} required />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t.employees.formShift}</Label>
            <Select name="shiftId" defaultValue={employee?.shiftId ?? shifts[0]?.id}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {shifts.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{translateLabel(s.name, locale)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t.employees.formSalaryType}</Label>
            <Select
              name="salaryType"
              value={salaryType}
              onValueChange={(v) => setSalaryType(v as "monthly" | "daily")}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">{t.employees.salaryMonthly}</SelectItem>
                <SelectItem value="daily">{t.employees.salaryDaily}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {salaryType === "monthly" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="basicSalary">{t.employees.formBasicSalary}</Label>
                <Input id="basicSalary" name="basicSalary" type="number" min={0} defaultValue={employee?.basicSalary} required />
              </div>
              <input type="hidden" name="dailyWorkingHours" value={employee?.dailyWorkingHours ?? 8} />
            </>
          ) : (
            <>
              <input type="hidden" name="basicSalary" value={0} />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dailyRate">{t.employees.formDailyRate}</Label>
                <Input id="dailyRate" name="dailyRate" type="number" min={0} defaultValue={employee?.dailyRate} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dailyWorkingHours">{t.employees.formDailyHours}</Label>
                <Input id="dailyWorkingHours" name="dailyWorkingHours" type="number" min={1} step="0.5" defaultValue={employee?.dailyWorkingHours ?? 8} />
              </div>
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="allowances">{t.employees.formAllowances}</Label>
            <Input id="allowances" name="allowances" type="number" min={0} defaultValue={employee?.allowances ?? 0} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="biometricDeviceUserId">{t.employees.formBiometricId}</Label>
            <Input id="biometricDeviceUserId" name="biometricDeviceUserId" defaultValue={employee?.biometricDeviceUserId} required />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t.employees.formStatus}</Label>
            <Select name="status" defaultValue={employee?.status ?? "active"}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t.employees.statusActive}</SelectItem>
                <SelectItem value="on_leave">{t.employees.statusOnLeave}</SelectItem>
                <SelectItem value="suspended">{t.employees.statusSuspended}</SelectItem>
                <SelectItem value="terminated">{t.employees.statusTerminated}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mt-2 border-t border-border pt-3 sm:col-span-2">
            <p className="text-sm font-semibold text-muted-foreground">{t.employees.sectionPersonal}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nationalId">{t.employees.formNationalId}</Label>
            <Input id="nationalId" name="nationalId" dir="ltr" inputMode="numeric" pattern="\d{14}" maxLength={14} defaultValue={employee?.nationalId} required />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">{t.employees.formPhone}</Label>
            <Input id="phone" name="phone" dir="ltr" defaultValue={employee?.phone} required />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qualification">{t.employees.formQualification}</Label>
            <Input id="qualification" name="qualification" defaultValue={employee?.qualification} required />
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
            <Input id="address" name="address" defaultValue={employee?.address} required />
          </div>

          <DialogFooter className="sm:col-span-2">
            <SubmitButton label={employee ? t.common.save : t.employees.addEmployee} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
