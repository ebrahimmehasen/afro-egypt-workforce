"use client";

import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** A table row that opens `href` when clicked anywhere (a real link inside the row stays the keyboard/middle-click path). */
export function ClickableRow({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <TableRow className={cn("cursor-pointer", className)} onClick={() => router.push(href)}>
      {children}
    </TableRow>
  );
}
