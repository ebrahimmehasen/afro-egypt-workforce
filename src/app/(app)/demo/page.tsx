import { notFound } from "next/navigation";
import { getDemoSnapshot } from "@/lib/actions/demo";
import { getT } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { DemoRunner } from "@/components/demo/demo-runner";
import { Badge } from "@/components/ui/badge";
import { DEMO_MODE } from "@/lib/demo-mode";

export default async function DemoPage() {
  if (!DEMO_MODE) notFound();
  const snapshot = await getDemoSnapshot();
  const t = await getT();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.demo.title}
        description={t.demo.description}
        actions={<Badge variant="warning">{t.app.demoMode}</Badge>}
      />
      <DemoRunner initialSnapshot={snapshot} />
    </div>
  );
}
