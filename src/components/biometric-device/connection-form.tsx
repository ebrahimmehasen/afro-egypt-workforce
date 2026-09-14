"use client";

import { useFormStatus } from "react-dom";
import { useActionState } from "react";
import { updateDeviceConnection } from "@/lib/actions/biometric-device";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DeviceConnection } from "@/lib/zk-device";

function SaveButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.common.save}</Button>;
}

export function DeviceConnectionForm({ connection }: { connection: DeviceConnection }) {
  const t = useT();
  const [state, formAction] = useActionState(updateDeviceConnection, {});
  useActionFeedback(state);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.biometricDevice.connectionTitle}</CardTitle>
        <CardDescription>{t.biometricDevice.connectionDesc}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ip">{t.biometricDevice.ip}</Label>
            <Input id="ip" name="ip" dir="ltr" defaultValue={connection.ip} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="port">{t.biometricDevice.port}</Label>
            <Input id="port" name="port" type="number" dir="ltr" min={1} max={65535} defaultValue={connection.port} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="commPassword">{t.biometricDevice.commPassword}</Label>
            <Input id="commPassword" name="commPassword" type="number" dir="ltr" min={0} defaultValue={connection.commPassword} />
          </div>
          <div className="sm:col-span-3">
            <SaveButton />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
