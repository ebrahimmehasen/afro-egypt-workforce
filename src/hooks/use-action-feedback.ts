"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

export interface ActionState {
  error?: string;
  success?: boolean;
  message?: string;
  /** Names of the form fields that failed validation, so the form can highlight them. */
  fields?: string[];
}

/**
 * React 19 resets a `<form action>` after the action finishes — even when it
 * returned an error — which wipes everything the user typed. Cancel that reset
 * (`ref={keepFilledFields}`): on success the dialog closes and unmounts
 * anyway, on an error the fields stay put so the user only fixes what's wrong.
 * A native listener, because React's own `onReset` is not consulted when React
 * itself triggers the reset.
 */
export function keepFilledFields(form: HTMLFormElement | null) {
  if (!form) return;
  const cancelReset = (e: Event) => e.preventDefault();
  form.addEventListener("reset", cancelReset);
  return () => form.removeEventListener("reset", cancelReset);
}

/** Watches a useActionState result and fires a toast + optional callback exactly once per change. */
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
