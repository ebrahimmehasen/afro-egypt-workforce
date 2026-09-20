"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { refreshDeviceDataAction } from "@/lib/actions/biometric-device";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";

/** Drops the cached device data and reloads the page so it reads from the device again. */
export function RetryButton() {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-2"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await refreshDeviceDataAction();
          router.refresh();
        })
      }
    >
      <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
      {t.biometricDevice.retry}
    </Button>
  );
}
