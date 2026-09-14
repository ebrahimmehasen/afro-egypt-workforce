"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Fingerprint, Link2, Link2Off, ScanFace, Trash2, XCircle } from "lucide-react";
import {
  cancelDeviceCaptureAction,
  deleteDeviceFingerprintAction,
  deleteDeviceUserAction,
  linkDeviceUserAction,
  startDeviceEnrollAction,
  unlinkDeviceUserAction,
  updateDeviceUserNameAction,
} from "@/lib/actions/biometric-device";
import { useT } from "@/components/providers/locale-provider";
import { format } from "@/lib/i18n/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DeviceUser } from "@/lib/zk-device";
import { Employee } from "@/lib/types";

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

function EditNameSection({ user }: { user: DeviceUser }) {
  const t = useT();
  const { pending, run } = useDeviceAction();
  const [name, setName] = useState(user.name);

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <Label htmlFor="device-user-name">{t.biometricDevice.editNameLabel}</Label>
        <div className="flex items-center gap-2">
          <Input id="device-user-name" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
          <Button
            size="sm"
            disabled={pending || !name.trim() || name.trim() === user.name}
            onClick={() => run(() => updateDeviceUserNameAction(user.uid, name, user.name), t.biometricDevice.nameSaved)}
          >
            {t.biometricDevice.saveName}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LinkEmployeeSection({
  user, linkedEmployee, employees,
}: { user: DeviceUser; linkedEmployee: Employee | null; employees: Employee[] }) {
  const t = useT();
  const { pending, run } = useDeviceAction();
  const unlinked = employees.filter((e) => !e.biometricDeviceUserId || e.biometricDeviceUserId === user.userId);
  const [selectedId, setSelectedId] = useState(linkedEmployee?.id ?? unlinked[0]?.id ?? "");

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="text-sm font-medium">{t.biometricDevice.linkEmployeeLabel}</div>
        {linkedEmployee && (
          <Badge variant="success" className="w-fit">{linkedEmployee.name}</Badge>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className="flex-1"><SelectValue placeholder={t.biometricDevice.linkEmployeeSelectPlaceholder} /></SelectTrigger>
            <SelectContent>
              {unlinked.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.name} — {e.employeeNumber}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={pending || !selectedId}
              className="gap-1.5"
              onClick={() => run(() => linkDeviceUserAction(user.userId, selectedId), t.biometricDevice.linkSaved)}
            >
              <Link2 className="h-4 w-4" />
              {linkedEmployee ? t.biometricDevice.changeLinkAction : t.biometricDevice.linkEmployeeAction}
            </Button>
            {linkedEmployee && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" disabled={pending}>
                    <Link2Off className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t.biometricDevice.unlinkAction}</AlertDialogTitle>
                    <AlertDialogDescription>{format(t.biometricDevice.unlinkConfirm, { name: linkedEmployee.name })}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => run(() => unlinkDeviceUserAction(user.userId), t.biometricDevice.unlinkSaved)}>
                      {t.biometricDevice.unlinkAction}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FingerprintsSection({ user }: { user: DeviceUser }) {
  const t = useT();
  const { pending, run } = useDeviceAction();
  const [finger, setFinger] = useState("0");

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="text-sm font-medium">{t.biometricDevice.fingerprintsTitle}</div>
        <p className="text-xs text-muted-foreground">{t.biometricDevice.fingerprintsDesc}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={finger} onValueChange={setFinger}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FINGER_SLOTS.map((f) => (
                <SelectItem key={f} value={String(f)}>{t.biometricDevice.finger} {f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              className="gap-1.5 text-primary"
              onClick={() => run(() => startDeviceEnrollAction(user.uid, Number(finger), user.name), t.biometricDevice.enrollStarted)}
            >
              <ScanFace className="h-4 w-4" />
              {t.biometricDevice.startEnrollTitle}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              className="gap-1.5"
              onClick={() => run(() => deleteDeviceFingerprintAction(user.uid, Number(finger), user.name), t.common.delete)}
            >
              <Fingerprint className="h-4 w-4" />
              {t.common.delete}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              className="gap-1.5"
              onClick={() => run(cancelDeviceCaptureAction, t.biometricDevice.captureCancelled)}
            >
              <XCircle className="h-4 w-4" />
              {t.biometricDevice.cancelCapture}
            </Button>
          </div>
        </div>
        <p className="text-xs font-medium text-warning">{format(t.biometricDevice.startEnrollNote, { name: user.name })}</p>
      </CardContent>
    </Card>
  );
}

export function DeviceUserDetail({
  user, linkedEmployee, employees,
}: {
  user: DeviceUser;
  linkedEmployee: Employee | null;
  employees: Employee[];
}) {
  const t = useT();
  const router = useRouter();
  const { pending, run } = useDeviceAction();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <EditNameSection user={user} />
        <LinkEmployeeSection user={user} linkedEmployee={linkedEmployee} employees={employees} />
        <FingerprintsSection user={user} />

        <Card className="border-dashed">
          <CardContent className="flex flex-col gap-1 p-4 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t.biometricDevice.cardTitle}</span>
            {user.cardno ? <span dir="ltr">{user.cardno}</span> : <span>{t.biometricDevice.cardUnsupported}</span>}
          </CardContent>
        </Card>

        <Card className="border-dashed">
          <CardContent className="flex flex-col gap-1 p-4 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t.biometricDevice.faceTitle}</span>
            <span>{t.biometricDevice.faceUnsupported}</span>
          </CardContent>
        </Card>
      </div>

      <div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={pending} className="gap-1.5">
              <Trash2 className="h-4 w-4" />
              {t.biometricDevice.deleteUserTitle}
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
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => run(
                  () => deleteDeviceUserAction(user.uid, user.name),
                  t.common.delete,
                  () => router.push("/biometric-device"),
                )}
              >
                {t.common.delete}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
