"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Listens for server-side data changes (via /api/events, an SSE stream) and
 * refreshes the current page's server-rendered data — so an edit anywhere in
 * the system (another user, another tab, a punch posted by a biometric
 * device) shows up live everywhere, with no manual reload. Debounced so a
 * burst of writes (e.g. calculating payroll for 50 employees) triggers one
 * refresh, not fifty. Mounted once in AppShell, so it runs on every page
 * behind a session.
 */
export function LiveRefresh() {
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/events");

    source.onmessage = (event) => {
      if (event.data !== "changed") return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => router.refresh(), 400);
    };

    return () => {
      source.close();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [router]);

  return null;
}
