"use client";

import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";

/** A table row that opens `href` when clicked anywhere (a real link inside the row stays the keyboard/middle-click path). */
export function ClickableRow({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <TableRow className="cursor-pointer" onClick={() => router.push(href)}>
      {children}
    </TableRow>
  );
}
