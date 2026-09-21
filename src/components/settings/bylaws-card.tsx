import { ScrollText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dictionary } from "@/lib/i18n/dictionary";

/** The internal bylaws as the system applies them — read-only; the numbers live in src/lib/pay-rules.ts. */
export function BylawsCard({ t }: { t: Dictionary }) {
  const rules = [
    t.bylaws.hours,
    t.bylaws.grace,
    t.bylaws.late,
    t.bylaws.earlyLeave,
    t.bylaws.absencePermitted,
    t.bylaws.absenceUnpermitted,
    t.bylaws.overtime,
    t.bylaws.dayRate,
    t.bylaws.payMonth,
    t.bylaws.weekOff,
    t.bylaws.automatic,
    t.bylaws.documents,
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-primary" />
          {t.bylaws.title}
        </CardTitle>
        <CardDescription>{t.bylaws.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex list-disc flex-col gap-2 ps-5 text-sm text-foreground">
          {rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
