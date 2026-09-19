"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import type { AppNotification, NotificationFeed } from "@/lib/notifications";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { intlLocale } from "@/lib/i18n/format";
import { DATA_CHANGED_EVENT } from "@/components/shared/live-refresh";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const SEEN_KEY = "afro_notifications_seen_at";

function readSeenAt(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

const toneDot: Record<AppNotification["tone"], string> = {
  info: "bg-primary",
  success: "bg-emerald-500",
  danger: "bg-destructive",
};

/**
 * Real notifications: pending things that need this user's decision (counted
 * until they act) plus outcomes of their own requests (counted until they open
 * the bell). Refetches on mount, on every live data change, and on locale change.
 */
export function NotificationBell() {
  const t = useT();
  const locale = useLocale();
  const [feed, setFeed] = useState<NotificationFeed>({ items: [], pendingCount: 0 });
  const [seenAt, setSeenAt] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (res.ok) setFeed((await res.json()) as NotificationFeed);
    } catch {
      // offline / restarting — keep what we have
    }
  }, []);

  useEffect(() => {
    setSeenAt(readSeenAt());
    void load();
    window.addEventListener(DATA_CHANGED_EVENT, load);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, load);
  }, [load, locale]);

  const unseenFyi = feed.items.filter((n) => !n.actionable && new Date(n.at).getTime() > seenAt).length;
  const badge = feed.pendingCount + unseenFyi;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    const now = Date.now();
    try {
      localStorage.setItem(SEEN_KEY, String(now));
    } catch {
      // storage unavailable — the badge simply won't clear across reloads
    }
    setSeenAt(now);
  };

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t.notifications.title}>
          <Bell className="h-5 w-5" />
          {badge > 0 && (
            <span className="absolute end-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">{t.notifications.title}</div>
        {feed.items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t.notifications.empty}</p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {feed.items.map((n) => (
              <li key={n.id}>
                <Link href={n.href} onClick={() => setOpen(false)} className="flex gap-3 px-4 py-3 hover:bg-muted">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", toneDot[n.tone])} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium leading-snug">{n.title}</span>
                    <span className="text-xs text-muted-foreground">{n.body}</span>
                    <span className="text-[11px] text-muted-foreground/80">{fmt(n.at)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
