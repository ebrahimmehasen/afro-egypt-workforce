"use client";

import { useT } from "@/components/providers/locale-provider";

/** An informational notice (it gates nothing): a permission is counted from the actual out and in punches. */
export function PunchReminder() {
  const t = useT();
  return (
    <p data-testid="punch-reminder" role="note" className="rounded-lg border-2 border-warning/60 bg-warning/10 px-3 py-2 text-sm font-medium text-foreground">
      {t.leaves.punchReminder}
    </p>
  );
}
