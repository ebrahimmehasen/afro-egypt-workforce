"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { DraftKind, DraftValues, FormDraft } from "@/lib/assistant/drafts";
import { useT } from "@/components/providers/locale-provider";

// A link from the assistant (`/leaves?assistant=…`) carries a form it filled in. This fetches it, takes the id
// out of the address, and hands it to the one dialog it is for, which opens already filled in. Nothing is saved:
// the admin looks it over and presses save.

interface DraftContext {
  draft: FormDraft | null;
  clear: () => void;
}

const Ctx = createContext<DraftContext>({ draft: null, clear: () => {} });

export function AssistantDraftProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const id = params.get("assistant");
  const [draft, setDraft] = useState<FormDraft | null>(null);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!id || handled.current === id) return;
    handled.current = id;
    const rest = new URLSearchParams(params.toString());
    rest.delete("assistant");
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
    fetch(`/api/assistant/draft?id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as { draft?: FormDraft } | null;
        if (res.ok && json?.draft) setDraft(json.draft);
        else toast.error(t.assistant.draftExpired);
      })
      .catch(() => toast.error(t.assistant.draftExpired));
  }, [id, params, pathname, router, t]);

  const clear = useCallback(() => setDraft(null), []);
  const value = useMemo(() => ({ draft, clear }), [draft, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The form the assistant filled in for this dialog, once, or null. */
export function useAssistantDraft(kind: DraftKind): { values: DraftValues | null; clear: () => void } {
  const { draft, clear } = useContext(Ctx);
  return { values: draft && draft.kind === kind ? draft.values : null, clear };
}
