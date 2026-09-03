"use client";

import { Bell, LogOut, Menu } from "lucide-react";
import { User } from "@/lib/types";
import { today } from "@/lib/today";
import { roleLabel, displayUserName } from "@/lib/i18n/labels";
import { intlLocale } from "@/lib/i18n/format";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/lib/actions/auth";

function formatToday(locale: "ar" | "en") {
  const d = new Date(`${today()}T00:00:00`);
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

export function Topbar({ user, onMenuClick }: { user: User; onMenuClick?: () => void }) {
  const t = useT();
  const locale = useLocale();
  const name = displayUserName(user, t);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick}>
          <Menu className="h-5 w-5" />
        </Button>
        <div className="hidden flex-col sm:flex">
          <span className="text-sm font-semibold text-foreground">{formatToday(locale)}</span>
          <span className="text-xs text-muted-foreground">{t.topbar.todayLabel}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <LanguageSwitcher />

        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          <span className="absolute end-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-full pe-1 ps-1.5 hover:bg-muted">
              <div className="hidden flex-col text-end sm:flex">
                <span className="text-sm font-semibold leading-tight">{name}</span>
                <span className="text-xs text-muted-foreground leading-tight">{roleLabel(user.role, t)}</span>
              </div>
              <Avatar>
                <AvatarFallback>{name.slice(0, 1)}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 text-destructive"
              onClick={() => {
                void logoutAction();
              }}
            >
              <LogOut className="h-4 w-4" />
              {t.topbar.logout}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
