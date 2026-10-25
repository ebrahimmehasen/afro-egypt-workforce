"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * A department card that opens the department's report when clicked anywhere — the card counterpart of
 * ClickableRow (the department name inside it stays a real link, for the keyboard and middle-click). Clicks in
 * `CardActions` (edit / delete, and the dialogs they open) never reach it.
 */
export function ClickableCard({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <div className={cn("cursor-pointer", className)} onClick={() => router.push(href)}>
      {children}
    </div>
  );
}

/** Keeps its clicks — and those of any dialog opened from it, which bubble through React — to itself. */
export function CardActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}
