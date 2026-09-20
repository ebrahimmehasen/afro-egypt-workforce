"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteEmployee } from "@/lib/actions/employees";
import { useT } from "@/components/providers/locale-provider";
import { format } from "@/lib/i18n/format";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function DeleteEmployeeButton({
  id,
  name,
  labeledTrigger = false,
  redirectTo,
}: {
  id: string;
  name: string;
  /** Text button instead of an icon — for the profile's Actions tab. */
  labeledTrigger?: boolean;
  /** Where to go after a successful delete (the profile page itself no longer exists). */
  redirectTo?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {labeledTrigger ? (
          <Button variant="outline" className="gap-2 text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" />
            {t.employees.deleteTitle}
          </Button>
        ) : (
          <Button variant="ghost" size="icon" aria-label={t.common.delete} className="text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.employees.deleteTitle}</AlertDialogTitle>
          <AlertDialogDescription>{format(t.employees.deleteConfirm, { name })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const res = await deleteEmployee(id);
                if (res?.error) {
                  toast.error(res.error);
                  return;
                }
                toast.success(res?.message ?? t.employees.deletedEmployee);
                if (redirectTo) router.push(redirectTo);
              });
            }}
          >
            {t.common.delete}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
