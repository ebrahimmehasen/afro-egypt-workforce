"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { UserCog } from "lucide-react";
import { createStaffAccount } from "@/lib/actions/staff";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : label}</Button>;
}

export function StaffAccountFormDialog() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createStaffAccount, {});
  useActionFeedback(state, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <UserCog className="h-4 w-4" />
          {t.users.addStaff}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.users.addStaff}</DialogTitle>
          <DialogDescription>{t.users.staffDescription}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sa-name">{t.users.name}</Label>
            <Input id="sa-name" name="name" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sa-email">{t.users.email}</Label>
            <Input id="sa-email" name="email" type="email" dir="ltr" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sa-password">{t.users.password}</Label>
            <Input id="sa-password" name="password" type="password" dir="ltr" minLength={8} required />
          </div>
          <p className="text-xs text-muted-foreground">{t.users.scopingHint}</p>

          <DialogFooter>
            <SubmitButton label={t.common.add} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
