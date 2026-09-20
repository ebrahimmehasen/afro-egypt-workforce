"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleCheck, CircleDashed, CircleX, Pause, Play, RefreshCw } from "lucide-react";
import {
  getRealtimeStatusAction, pauseRealtimeSyncAction, resumeRealtimeSyncAction, syncAttendanceNowAction,
} from "@/lib/actions/biometric-device";
import { useT } from "@/components/providers/locale-provider";
import { format } from "@/lib/i18n/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type RealtimeStatus = "connected" | "paused" | "reconnecting";

const STATUS_POLL_MS = 5000;

export function SyncAttendanceCard({ initialStatus }: { initialStatus: RealtimeStatus }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(initialStatus);
  const previous = useRef(initialStatus);

  // The status is read from memory on the server (no device traffic), so polling it is cheap. It keeps
  // the badge honest after a power cut, and reloads the page's device data the moment the device is back.
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await getRealtimeStatusAction().catch(() => null);
      if (stopped || !res || !("status" in res)) return;
      setStatus(res.status);
      if (previous.current !== "connected" && res.status === "connected") router.refresh();
      previous.current = res.status;
    };
    const id = setInterval(tick, STATUS_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [router]);

  function sync() {
    startTransition(async () => {
      const res = await syncAttendanceNowAction();
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      const { imported } = res.result;
      toast.success(imported > 0 ? format(t.biometricDevice.syncNewPunches, { count: imported }) : t.biometricDevice.syncNoNew);
      router.refresh();
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
      previous.current = "paused";
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
      // don't assume it connected — the device may still be unreachable; the poll reports the truth
      const next = await getRealtimeStatusAction().catch(() => null);
      const actual = next && "status" in next ? next.status : "reconnecting";
      setStatus(actual);
      previous.current = actual;
      toast.success(t.biometricDevice.resumedDone);
    });
  }

  const badge = {
    connected: { icon: CircleCheck, label: t.biometricDevice.realtimeConnected, variant: "success" as const, desc: t.biometricDevice.syncDescConnected },
    paused: { icon: Pause, label: t.biometricDevice.realtimePaused, variant: "outline" as const, desc: t.biometricDevice.syncDescPaused },
    reconnecting: { icon: status === "reconnecting" ? CircleX : CircleDashed, label: t.biometricDevice.realtimeReconnecting, variant: "destructive" as const, desc: t.biometricDevice.syncDescReconnecting },
  }[status];

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">{t.biometricDevice.syncSectionTitle}</h2>
            <Badge variant={badge.variant} className="gap-1">
              <badge.icon className="h-3.5 w-3.5" />
              {badge.label}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{badge.desc}</p>
        </div>

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
      </CardContent>
    </Card>
  );
}
