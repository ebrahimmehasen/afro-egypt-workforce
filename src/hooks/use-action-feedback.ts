"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

export interface ActionState {
  error?: string;
  success?: boolean;
  message?: string;
}

/** Watches a useFormState result and fires a toast + optional callback exactly once per change. */
export function useActionFeedback(state: ActionState, onSuccess?: () => void) {
  const prev = useRef<ActionState>({});
  useEffect(() => {
    if (state === prev.current) return;
    prev.current = state;
    if (state?.error) {
      toast.error(state.error);
    } else if (state?.success) {
      toast.success(state.message ?? "تم الحفظ بنجاح");
      onSuccess?.();
    }
  }, [state, onSuccess]);
}
