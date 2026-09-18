"use client";

import { useEffect } from "react";

// After a new deploy, a tab left open from before still holds the old chunk
// manifest — navigating in it then 404s on chunk files that no longer exist.
// Reload once (not in a loop) to pick up the new build instead of leaving
// the user stuck on a broken page.
const RELOADED_FLAG = "afro-egypt-chunk-reload";

function isChunkLoadError(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  const name = reason instanceof Error ? reason.name : "";
  return name === "ChunkLoadError" || /Loading chunk [\w-]+ failed/i.test(message);
}

function reloadOnce() {
  if (sessionStorage.getItem(RELOADED_FLAG)) return;
  sessionStorage.setItem(RELOADED_FLAG, "1");
  window.location.reload();
}

export function ChunkReloadOnDeploy() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (isChunkLoadError(event.error)) reloadOnce();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadError(event.reason)) reloadOnce();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
