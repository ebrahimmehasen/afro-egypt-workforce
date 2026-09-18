"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CircleCheck, CircleDashed, Pause, Play, RefreshCw } from "lucide-react";
import {
  pauseRealtimeSyncAction, resumeRealtimeSyncAction, syncAttendanceNowAction,
} from "@/lib/actions/biometric-device";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type RealtimeStatus = "connected" | "paused" | "reconnecting";

export function SyncAttendanceCard({ initialStatus }: { initialStatus: RealtimeStatus }) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(initialStatus);
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

  function pause() {
    startTransition(async () => {
      const res = await pauseRealtimeSyncAction();
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setStatus("paused");
      toast.success(t.biometricDevice.pausedDone);
    });
  }

  function resume() {
    startTransition(async () => {
      const res = await resumeRealtimeSyncAction();
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setStatus("connected");
      toast.success(t.biometricDevice.resumedDone);
    });
  }

  const statusBadge = {
    connected: { icon: CircleCheck, label: t.biometricDevice.realtimeConnected, variant: "success" as const },
    paused: { icon: Pause, label: t.biometricDevice.realtimePaused, variant: "outline" as const },
    reconnecting: { icon: CircleDashed, label: t.biometricDevice.realtimeReconnecting, variant: "secondary" as const },
  }[status];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t.biometricDevice.syncSectionTitle}
          <Badge variant={statusBadge.variant} className="gap-1">
            <statusBadge.icon className="h-3.5 w-3.5" />
            {statusBadge.label}
          </Badge>
        </CardTitle>
        <CardDescription>{t.biometricDevice.syncSectionDesc}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="gap-2" disabled={pending} onClick={sync}>
            <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
            {t.biometricDevice.syncNow}
          </Button>

          {status === "paused" ? (
            <Button className="gap-2" disabled={pending} onClick={resume}>
              <Play className="h-4 w-4" />
              {t.biometricDevice.resumeRealtime}
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="gap-2" disabled={pending}>
                  <Pause className="h-4 w-4" />
                  {t.biometricDevice.pauseRealtime}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t.biometricDevice.pauseRealtime}</AlertDialogTitle>
                  <AlertDialogDescription>{t.biometricDevice.pauseRealtimeConfirm}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                  <AlertDialogAction onClick={pause}>{t.common.confirm}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
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
