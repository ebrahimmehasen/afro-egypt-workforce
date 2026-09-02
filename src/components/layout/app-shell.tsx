"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { X } from "lucide-react";
import { User } from "@/lib/types";
import { COMPANY } from "@/lib/constants";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Topbar } from "@/components/layout/topbar";
import { cn } from "@/lib/utils";

export function AppShell({
  user,
  allowedPaths,
  children,
}: {
  user: User;
  allowedPaths: string[];
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-e border-border bg-background lg:flex">
        <SidebarBrand />
        <SidebarNav allowedPaths={allowedPaths} />
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute top-0 h-full w-72 max-w-[80vw] border-e border-border bg-background start-0 flex flex-col">
            <div className="flex items-center justify-between px-2">
              <SidebarBrand />
              <button className="p-3 text-muted-foreground" onClick={() => setMobileOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarNav allowedPaths={allowedPaths} />
          </aside>
        </div>
      )}

      <div className="flex min-h-screen flex-1 flex-col">
        <Topbar user={user} onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

function SidebarBrand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-3 px-4 py-4">
      <div className={cn("relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white p-1 ring-1 ring-border")}>
        <Image src={COMPANY.logo} alt={COMPANY.name} fill className="object-contain" />
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-extrabold text-foreground">{COMPANY.name}</span>
        <span className="text-[11px] text-muted-foreground">{COMPANY.productName}</span>
      </div>
    </Link>
  );
}
