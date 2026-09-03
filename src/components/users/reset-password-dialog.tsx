"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useState } from "react";
import { KeyRound } from "lucide-react";
import { resetUserPassword } from "@/lib/actions/users";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";

function SubmitButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.users.resetPassword}</Button>;
}

export function ResetPasswordDialog({ userId, userName }: { userId: string; userName: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(resetUserPassword, {});
  useActionFeedback(state, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t.users.resetPassword}>
          <KeyRound className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.users.resetPassword} — {userName}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={userId} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rp-pw">{t.users.newPassword}</Label>
            <Input id="rp-pw" name="password" type="password" dir="ltr" minLength={8} required />
          </div>
          <DialogFooter>
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
