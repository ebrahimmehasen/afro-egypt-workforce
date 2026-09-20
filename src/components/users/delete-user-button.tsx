"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteUser } from "@/lib/actions/users";
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

export function DeleteUserButton({ userId, userName }: { userId: string; userName: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="gap-2 text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" />
          {t.users.deleteUser}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.users.deleteUserTitle}</AlertDialogTitle>
          <AlertDialogDescription>{format(t.users.deleteUserConfirm, { name: userName })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const res = await deleteUser(userId);
                if (res?.error) {
                  toast.error(res.error);
                  return;
                }
                toast.success(res?.message ?? t.users.userDeleted);
                // the details page no longer exists for this user
                router.push("/users");
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
