"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { createDepartment, updateDepartment } from "@/lib/actions/departments";
import { useActionFeedback, keepFilledFields } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Department } from "@/lib/types";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : label}</Button>;
}

const selectCls = "h-10 rounded-md border border-input bg-background px-3 text-sm";

export interface ManagerOption {
  id: string;
  name: string;
  employeeNumber: string;
}

export function DepartmentFormDialog({
  department,
  employees,
}: {
  department?: Department;
  employees: ManagerOption[];
}) {
  const t = useT();
  // A legacy free-typed manager that isn't an employee can't be pre-selected —
  // leave it blank so the form forces a real pick.
  const currentManager = employees.some((e) => e.name === department?.managerName) ? department?.managerName : "";
  const [open, setOpen] = useState(false);
  const action = department ? updateDepartment : createDepartment;
  const [state, formAction] = useActionState(action, {});
  useActionFeedback(state, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {department ? (
          <Button variant="ghost" size="icon" aria-label={t.common.edit}><Pencil className="h-4 w-4" /></Button>
        ) : (
          <Button className="gap-2"><Plus className="h-4 w-4" />{t.departments.addDepartment}</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{department ? t.departments.editDepartment : t.departments.addDepartment}</DialogTitle>
        </DialogHeader>
        <form action={formAction} ref={keepFilledFields} className="flex flex-col gap-4">
          {department && <input type="hidden" name="id" value={department.id} />}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">{t.departments.formName}</Label>
            <Input id="name" name="name" defaultValue={department?.name} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="managerName">{t.departments.formManager}</Label>
            <select id="managerName" name="managerName" defaultValue={currentManager} className={selectCls} required>
              <option value="">— {t.departments.selectManager} —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.name}>{e.name} — {e.employeeNumber}</option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <SubmitButton label={department ? t.common.save : t.common.add} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
