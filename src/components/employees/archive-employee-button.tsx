"use client";

import { useTransition } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import { archiveEmployee, unarchiveEmployee } from "@/lib/actions/employees";
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

/**
 * The profile's "أرشفة الموظف" button (with a confirmation), or — for an employee someone archived by hand —
 * "إلغاء الأرشفة". An employee archived by the one-month rule gets neither switch: they come back through their status.
 */
export function ArchiveEmployeeButton({
  id,
  name,
  archived,
  manuallyArchived,
}: {
  id: string;
  name: string;
  archived: boolean;
  manuallyArchived: boolean;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();

  function run(action: (id: string) => Promise<{ error?: string; message?: string }>, fallback: string) {
    startTransition(async () => {
      const res = await action(id);
      if (res?.error) toast.error(res.error);
      else toast.success(res?.message ?? fallback);
    });
  }

  if (archived) {
    if (!manuallyArchived) return <p className="text-sm text-muted-foreground">{t.employees.unarchiveByStatus}</p>;
    return (
      <Button variant="outline" className="gap-2" disabled={pending} onClick={() => run(unarchiveEmployee, t.employees.unarchivedEmployee)}>
        <ArchiveRestore className="h-4 w-4" />
        {t.employees.unarchiveTitle}
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="gap-2" disabled={pending}>
          <Archive className="h-4 w-4" />
          {t.employees.archiveTitle}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.employees.archiveTitle}</AlertDialogTitle>
          <AlertDialogDescription>{format(t.employees.archiveConfirm, { name })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={() => run(archiveEmployee, t.employees.archivedEmployee)}>
            {t.employees.archiveTitle}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
