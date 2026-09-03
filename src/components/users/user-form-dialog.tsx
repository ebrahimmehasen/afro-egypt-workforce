"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { createUser, updateUser } from "@/lib/actions/users";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import type { Role } from "@/lib/types";

type Opt = { id: string; name: string };
type ExistingUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  employeeId: string | null;
  departmentId: string | null;
};

const selectCls = "h-10 rounded-md border border-input bg-background px-3 text-sm";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : label}</Button>;
}

export function UserFormDialog({
  user,
  employees,
  departments,
}: {
  user?: ExistingUser;
  employees: Opt[];
  departments: Opt[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const action = user ? updateUser : createUser;
  const [state, formAction] = useActionState(action, {});
  useActionFeedback(state, () => setOpen(false));

  const roles: Role[] = ["admin", "hr", "supervisor", "employee"];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {user ? (
          <Button variant="ghost" size="icon" aria-label={t.common.edit}><Pencil className="h-4 w-4" /></Button>
        ) : (
          <Button className="gap-2"><Plus className="h-4 w-4" />{t.users.addUser}</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user ? t.users.editUser : t.users.addUser}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {user && <input type="hidden" name="id" value={user.id} />}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="u-name">{t.users.name}</Label>
            <Input id="u-name" name="name" defaultValue={user?.name} required />
          </div>

          {!user && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="u-email">{t.users.email}</Label>
                <Input id="u-email" name="email" type="email" dir="ltr" required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="u-password">{t.users.password}</Label>
                <Input id="u-password" name="password" type="password" dir="ltr" minLength={8} required />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u-role">{t.users.role}</Label>
              <select id="u-role" name="role" defaultValue={user?.role ?? "employee"} className={selectCls}>
                {roles.map((r) => (
                  <option key={r} value={r}>{t.roles[r]}</option>
                ))}
              </select>
            </div>
            {user && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="u-active">{t.users.status}</Label>
                <select id="u-active" name="active" defaultValue={String(user.active)} className={selectCls}>
                  <option value="true">{t.users.active}</option>
                  <option value="false">{t.users.inactive}</option>
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u-emp">{t.users.linkedEmployee}</Label>
              <select id="u-emp" name="employeeId" defaultValue={user?.employeeId ?? "none"} className={selectCls}>
                <option value="none">— {t.common.all} —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u-dep">{t.users.linkedDepartment}</Label>
              <select id="u-dep" name="departmentId" defaultValue={user?.departmentId ?? "none"} className={selectCls}>
                <option value="none">— {t.common.all} —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{t.users.scopingHint}</p>

          <DialogFooter>
            <SubmitButton label={user ? t.common.save : t.common.add} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
