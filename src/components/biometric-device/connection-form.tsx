"use client";

import { useFormStatus } from "react-dom";
import { useActionState, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
import { testDeviceConnectionAction, updateDeviceConnection } from "@/lib/actions/biometric-device";
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
  const [editing, setEditing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [saveState, saveAction] = useActionState(updateDeviceConnection, {});
  const [testState, testAction, testPending] = useActionState(testDeviceConnectionAction, {});
  useActionFeedback(saveState, () => setEditing(false));
  useActionFeedback(testState);

  if (!editing) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-4">
          <div className="text-sm text-muted-foreground">
            {t.biometricDevice.connectionSummary} <span dir="ltr" className="font-mono">{connection.ip}:{connection.port}</span>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setEditing(true)}>
            <Settings2 className="h-4 w-4" />
            {t.biometricDevice.editConnection}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.biometricDevice.connectionTitle}</CardTitle>
        <CardDescription>{t.biometricDevice.connectionDesc}</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} action={saveAction} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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

          <div className="flex items-center gap-2 sm:col-span-3">
            <SaveButton />
            <Button
              type="button"
              variant="outline"
              disabled={testPending}
              onClick={() => formRef.current && testAction(new FormData(formRef.current))}
            >
              {testPending ? t.common.saving : t.biometricDevice.testConnection}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>{t.common.cancel}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
