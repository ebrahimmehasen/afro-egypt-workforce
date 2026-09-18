"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteLeave } from "@/lib/actions/leaves";
import { useT } from "@/components/providers/locale-provider";
import { format } from "@/lib/i18n/format";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function DeleteLeaveButton({ id, name }: { id: string; name: string }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.leaves.deleteTitle}</AlertDialogTitle>
          <AlertDialogDescription>{format(t.leaves.deleteConfirm, { name })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const res = await deleteLeave(id);
                if (res?.error) toast.error(res.error);
                else toast.success(res?.message ?? t.leaves.deleted);
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
