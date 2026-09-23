import { prisma } from "@/lib/prisma";
import { requireAccess } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { PageHeader } from "@/components/shared/page-header";
import { ChangeRequestsTable } from "@/components/change-requests/change-requests-table";

export default async function ChangeRequestsPage() {
  await requireAccess("/change-requests");
  const t = await getT();

  const requests = await prisma.changeRequest.findMany({ orderBy: { createdAt: "desc" } });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.changeRequests.title} description={t.changeRequests.description} />
      <ChangeRequestsTable
        requests={requests.map((r) => ({
          id: r.id,
          requestedBy: r.requestedBy,
          module: r.module,
          actionLabel: r.actionLabel,
          summary: r.summary,
          status: r.status,
          direct: r.direct,
          reviewedBy: r.reviewedBy,
          reviewNote: r.reviewNote,
          createdAt: r.createdAt.toISOString(),
          reviewedAt: r.reviewedAt?.toISOString() ?? null,
          // what the request will write when approved - shown, field by field, in the details popup
          payload: r.payload,
        }))}
      />
    </div>
  );
}
