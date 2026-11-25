"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers/locale-provider";

export function PrintButton({ label }: { label?: string } = {}) {
  const t = useT();
  return (
    <Button onClick={() => window.print()} className="gap-2 no-print">
      <Printer className="h-4 w-4" />
      {label ?? t.payslip.print}
    </Button>
  );
}
