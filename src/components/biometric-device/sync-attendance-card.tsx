"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { syncAttendanceNowAction } from "@/lib/actions/biometric-device";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export function SyncAttendanceCard() {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<{ imported: number; skippedUnlinked: number; skippedDuplicate: number } | null>(null);

  function sync() {
    startTransition(async () => {
      const res = await syncAttendanceNowAction();
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setSummary(res.result);
      toast.success(t.biometricDevice.syncDone);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.biometricDevice.syncSectionTitle}</CardTitle>
        <CardDescription>{t.biometricDevice.syncSectionDesc}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button className="w-fit gap-2" disabled={pending} onClick={sync}>
          <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
          {t.biometricDevice.syncNow}
        </Button>
        {summary && (
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span>{t.biometricDevice.syncImported}: <span className="font-semibold text-foreground">{summary.imported}</span></span>
            <span>{t.biometricDevice.syncUnlinked}: <span className="font-semibold text-foreground">{summary.skippedUnlinked}</span></span>
            <span>{t.biometricDevice.syncDuplicate}: <span className="font-semibold text-foreground">{summary.skippedDuplicate}</span></span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
