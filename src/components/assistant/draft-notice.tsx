"use client";

import { Sparkles } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";

/** Shown at the top of a form the assistant filled in: it is only a suggestion until the admin saves it. */
export function AssistantDraftNotice() {
  const t = useT();
  return (
    <p className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
      <Sparkles className="h-4 w-4 shrink-0" />
      {t.assistant.draftNotice}
    </p>
  );
}
