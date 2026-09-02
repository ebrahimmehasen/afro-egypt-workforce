"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useState } from "react";
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
  const action = employee ? updateEmployee : createEmployee;
  const [state, formAction] = useFormState(action, {});
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
            <Label htmlFor="basicSalary">{t.employees.formBasicSalary}</Label>
            <Input id="basicSalary" name="basicSalary" type="number" min={0} defaultValue={employee?.basicSalary} required />
          </div>

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

          <DialogFooter className="sm:col-span-2">
            <SubmitButton label={employee ? t.common.save : t.employees.addEmployee} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
