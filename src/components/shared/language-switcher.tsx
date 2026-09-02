"use client";

import { useTransition } from "react";
import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { setLocale } from "@/lib/actions/locale";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";

export function LanguageSwitcher({ variant = "ghost" }: { variant?: "ghost" | "outline" }) {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = locale === "ar" ? "en" : "ar";
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <Button variant={variant} size="sm" className="gap-1.5" onClick={toggle} disabled={pending}>
      <Languages className="h-4 w-4" />
      {t.topbar.language}
    </Button>
  );
}
