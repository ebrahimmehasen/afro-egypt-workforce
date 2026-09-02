import Link from "next/link";
import { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  icon: Icon,
  tone = "default",
  hint,
  href,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: "default" | "success" | "warning" | "destructive" | "primary";
  hint?: string;
  /** When set, the whole card becomes a link that drills into the filtered list behind this number. */
  href?: string;
}) {
  const toneClasses: Record<string, string> = {
    default: "bg-muted text-foreground",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    destructive: "bg-destructive/10 text-destructive",
    primary: "bg-primary/10 text-primary",
  };

  const card = (
    <Card className={cn(href && "transition-colors hover:border-primary/50 hover:bg-muted/40")}>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <span className="text-2xl font-extrabold tabular-nums text-foreground">{value}</span>
          {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
        </div>
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", toneClasses[tone])}>
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );

  if (!href) return card;

  return (
    <Link href={href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      {card}
    </Link>
  );
}
