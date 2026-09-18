"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { updateUserPermissions } from "@/lib/actions/permissions";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { roleLabel } from "@/lib/i18n/labels";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { PermissionKey } from "@/lib/permissions";
import type { Role } from "@/lib/types";

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  permissions: string[];
  departmentIds: string[];
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" size="sm" disabled={pending}>{pending ? t.common.saving : label}</Button>;
}

export function PermissionsEditor({
  user,
  keys,
  departments,
}: {
  user: StaffUser;
  keys: PermissionKey[];
  departments: { id: string; name: string }[];
}) {
  const t = useT();
  const [state, formAction] = useActionState(updateUserPermissions, {});
  useActionFeedback(state);
  const [granted, setGranted] = useState<Set<string>>(new Set(user.permissions));
  const [scopedDepts, setScopedDepts] = useState<Set<string>>(new Set(user.departmentIds));
  const [active, setActive] = useState(user.active);

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>) => (key: string) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const togglePerm = toggle(setGranted);
  const toggleDept = toggle(setScopedDepts);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <div>
          <p className="font-semibold text-foreground">{user.name}</p>
          <p dir="ltr" className="text-xs text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{roleLabel(user.role, t)}</Badge>
          {granted.size === 0 && <Badge variant="warning">{t.permissions.pendingBadge}</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={user.id} />

          <div className="flex flex-col gap-2">
            <Label className="text-xs text-muted-foreground">{t.permissions.pagesLabel}</Label>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              {keys.map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    name={`perm_${key}`}
                    checked={granted.has(key)}
                    onCheckedChange={() => togglePerm(key)}
                  />
                  <span>{t.permissions.keys[key]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <Label className="text-xs text-muted-foreground">{t.permissions.departmentsLabel}</Label>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              {departments.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    name={`dept_${d.id}`}
                    checked={scopedDepts.has(d.id)}
                    onCheckedChange={() => toggleDept(d.id)}
                  />
                  <span>{d.name}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {scopedDepts.size === 0 ? t.permissions.allDepartmentsHint : null}
            </p>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`active-${user.id}`}
                name="active"
                checked={active}
                onCheckedChange={(v) => setActive(v === true)}
              />
              <Label htmlFor={`active-${user.id}`} className="text-sm">{t.permissions.activeToggle}</Label>
            </div>
            <SubmitButton label={t.permissions.save} />
          </div>
          <p className="text-xs text-muted-foreground">{t.permissions.grantHint}</p>
        </form>
      </CardContent>
    </Card>
  );
}
