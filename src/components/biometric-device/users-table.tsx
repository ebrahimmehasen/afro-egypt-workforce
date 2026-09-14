"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Fingerprint, ScanFace, Trash2, XCircle } from "lucide-react";
import {
  cancelDeviceCaptureAction, deleteDeviceFingerprintAction, deleteDeviceUserAction, startDeviceEnrollAction,
} from "@/lib/actions/biometric-device";
import { useT } from "@/components/providers/locale-provider";
import { format } from "@/lib/i18n/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DeviceUser } from "@/lib/zk-device";

const FINGER_SLOTS = Array.from({ length: 10 }, (_, i) => i);

function useDeviceAction() {
  const [pending, startTransition] = useTransition();
  function run(action: () => Promise<{ error?: string; success?: boolean }>, successMessage: string, onDone?: () => void) {
    startTransition(async () => {
      const res = await action();
      if (res?.error) toast.error(res.error);
      else {
        toast.success(successMessage);
        onDone?.();
      }
    });
  }
  return { pending, run };
}

function DeleteUserButton({ user }: { user: DeviceUser }) {
  const t = useT();
  const { pending, run } = useDeviceAction();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" title={t.biometricDevice.deleteUserTitle}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.biometricDevice.deleteUserTitle}</AlertDialogTitle>
          <AlertDialogDescription>{format(t.biometricDevice.deleteUserConfirm, { name: user.name })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => run(() => deleteDeviceUserAction(user.uid, user.name), t.common.delete)}
          >
            {t.common.delete}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteFingerprintButton({ user }: { user: DeviceUser }) {
  const t = useT();
  const { pending, run } = useDeviceAction();
  const [finger, setFinger] = useState("0");

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" title={t.biometricDevice.deleteFingerprintTitle}>
          <Fingerprint className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.biometricDevice.deleteFingerprintTitle}</AlertDialogTitle>
          <AlertDialogDescription>{format(t.biometricDevice.deleteFingerprintConfirm, { name: user.name, finger })}</AlertDialogDescription>
        </AlertDialogHeader>
        <Select value={finger} onValueChange={setFinger}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {FINGER_SLOTS.map((f) => (
              <SelectItem key={f} value={String(f)}>{t.biometricDevice.finger} {f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => run(() => deleteDeviceFingerprintAction(user.uid, Number(finger), user.name), t.common.delete)}
          >
            {t.common.delete}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function StartEnrollButton({ user }: { user: DeviceUser }) {
  const t = useT();
  const { pending, run } = useDeviceAction();
  const [finger, setFinger] = useState("0");

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="text-primary" title={t.biometricDevice.startEnrollTitle}>
          <ScanFace className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.biometricDevice.startEnrollTitle}</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-2">
            <span>{format(t.biometricDevice.startEnrollConfirm, { name: user.name, finger })}</span>
            <span className="font-medium text-warning">{format(t.biometricDevice.startEnrollNote, { name: user.name })}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Select value={finger} onValueChange={setFinger}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {FINGER_SLOTS.map((f) => (
              <SelectItem key={f} value={String(f)}>{t.biometricDevice.finger} {f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={() => run(() => startDeviceEnrollAction(user.uid, Number(finger), user.name), t.biometricDevice.enrollStarted)}
          >
            {t.common.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CancelCaptureButton() {
  const t = useT();
  const { pending, run } = useDeviceAction();
  return (
    <Button variant="outline" size="sm" className="gap-2" disabled={pending} onClick={() => run(cancelDeviceCaptureAction, t.biometricDevice.captureCancelled)}>
      <XCircle className="h-4 w-4" /> {t.biometricDevice.cancelCapture}
    </Button>
  );
}

export function DeviceUsersTable({
  users,
  employeesByDeviceUserId,
}: {
  users: DeviceUser[];
  employeesByDeviceUserId: Record<string, string>;
}) {
  const t = useT();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        <CancelCaptureButton />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.biometricDevice.uid}</TableHead>
              <TableHead>{t.biometricDevice.deviceUserId}</TableHead>
              <TableHead>{t.biometricDevice.name}</TableHead>
              <TableHead>{t.biometricDevice.linkedEmployee}</TableHead>
              <TableHead>{t.biometricDevice.card}</TableHead>
              <TableHead className="text-end">{t.common.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const linkedName = employeesByDeviceUserId[u.userId];
              return (
                <TableRow key={u.uid}>
                  <TableCell dir="ltr" className="tabular-nums">{u.uid}</TableCell>
                  <TableCell dir="ltr" className="tabular-nums">{u.userId}</TableCell>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell>
                    {linkedName ? (
                      <Badge variant="success">{linkedName}</Badge>
                    ) : (
                      <Badge variant="outline">{t.biometricDevice.notLinked}</Badge>
                    )}
                  </TableCell>
                  <TableCell dir="ltr">{u.cardno || "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-0.5">
                      <StartEnrollButton user={u} />
                      <DeleteFingerprintButton user={u} />
                      <DeleteUserButton user={u} />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
