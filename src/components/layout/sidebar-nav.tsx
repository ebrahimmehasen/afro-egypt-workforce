"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, Building2, Clock, Fingerprint, CalendarDays,
  TimerReset, MinusCircle, Wallet, FileBarChart, TrendingUp, History, Settings, ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { NAV_ITEMS, navLabel } from "@/lib/i18n/labels";
import { useT } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Users, Building2, Clock, Fingerprint, CalendarDays,
  TimerReset, MinusCircle, Wallet, FileBarChart, TrendingUp, History, Settings, ShieldCheck,
};

export function SidebarNav({ allowedPaths }: { allowedPaths: string[] }) {
  const pathname = usePathname();
  const t = useT();
  const items = NAV_ITEMS.filter((item) => allowedPaths.includes(item.href));

  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-ink-600 hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className={cn("h-[18px] w-[18px] shrink-0", active && "text-primary")} />
            <span>{navLabel(item.key, t)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
