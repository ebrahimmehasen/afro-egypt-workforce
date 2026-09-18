"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Power, PowerOff, RefreshCw, Trash2 } from "lucide-react";
import {
  clearDeviceLogAction, restartDeviceAction, setDeviceEnabledAction,
} from "@/lib/actions/biometric-device";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function DeviceActions() {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [confirmText, setConfirmText] = useState("");

  function run(action: () => Promise<{ error?: string; success?: boolean }>, successMessage: string) {
    startTransition(async () => {
      const res = await action();
      if (res?.error) toast.error(res.error);
      else toast.success(successMessage);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.biometricDevice.actionsTitle}</CardTitle>
        <CardDescription>{t.biometricDevice.actionsDesc}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          className="gap-2"
          disabled={pending}
          onClick={() => run(() => setDeviceEnabledAction(true), t.biometricDevice.deviceEnabled)}
        >
          <Power className="h-4 w-4" /> {t.biometricDevice.enableDevice}
        </Button>

        <Button
          variant="outline"
          className="gap-2"
          disabled={pending}
          onClick={() => run(() => setDeviceEnabledAction(false), t.biometricDevice.deviceDisabled)}
        >
          <PowerOff className="h-4 w-4" /> {t.biometricDevice.disableDevice}
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="gap-2" disabled={pending}>
              <RefreshCw className="h-4 w-4" /> {t.biometricDevice.restartDevice}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.biometricDevice.restartDevice}</AlertDialogTitle>
              <AlertDialogDescription>{t.biometricDevice.restartConfirm}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
              <AlertDialogAction disabled={pending} onClick={() => run(restartDeviceAction, t.biometricDevice.restartDone)}>
                {t.common.confirm}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog onOpenChange={(open) => !open && setConfirmText("")}>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="gap-2 text-destructive hover:text-destructive" disabled={pending}>
              <Trash2 className="h-4 w-4" /> {t.biometricDevice.clearLog}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.biometricDevice.clearLogTitle}</AlertDialogTitle>
              <AlertDialogDescription>{t.biometricDevice.clearLogDesc}</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="clearLogConfirm">{t.biometricDevice.clearLogConfirmLabel}</Label>
              <Input
                id="clearLogConfirm"
                dir="ltr"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending || confirmText.trim() !== t.biometricDevice.clearLogConfirmWord}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => run(() => clearDeviceLogAction(confirmText), t.biometricDevice.clearLogDone)}
              >
                {t.common.delete}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
