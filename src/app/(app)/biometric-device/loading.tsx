import { getT } from "@/lib/i18n";
import { SkeletonPage } from "@/components/ui/skeleton";
import { PageHeaderSkeleton, KpiCardsSkeleton, FormSkeleton, TableSkeleton } from "@/components/skeletons";

export default async function Loading() {
  const t = await getT();
  return (
    <SkeletonPage label={t.common.loadingEllipsis}>
      <PageHeaderSkeleton />
      <KpiCardsSkeleton count={4} />
      <FormSkeleton rows={3} />
      <FormSkeleton rows={1} />
      <TableSkeleton rows={6} cols={6} />
    </SkeletonPage>
  );
}
