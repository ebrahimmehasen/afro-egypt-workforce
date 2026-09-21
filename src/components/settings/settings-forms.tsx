"use client";

import { useFormStatus } from "react-dom";
import { useActionState } from "react";
import { updateCompanySettings } from "@/lib/actions/settings";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CompanySettings } from "@/lib/types";

function SaveButton() {
  const { pending } = useFormStatus();
  const t = useT();
  return <Button type="submit" disabled={pending}>{pending ? t.common.saving : t.common.save}</Button>;
}

export function CompanySettingsForm({ settings }: { settings: CompanySettings }) {
  const t = useT();
  const [state, formAction] = useActionState(updateCompanySettings, {});
  useActionFeedback(state);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.settings.companySettingsTitle}</CardTitle>
        <CardDescription>{t.settings.companySettingsDesc}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="companyName">{t.settings.companyName}</Label>
            <Input id="companyName" name="companyName" defaultValue={settings.companyName} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address">{t.settings.address}</Label>
            <Input id="address" name="address" defaultValue={settings.address} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">{t.settings.phone}</Label>
            <Input id="phone" name="phone" dir="ltr" defaultValue={settings.phone} required />
          </div>
          <div>
            <SaveButton />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
