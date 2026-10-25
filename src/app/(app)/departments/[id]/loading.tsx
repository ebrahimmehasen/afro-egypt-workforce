import { getT } from "@/lib/i18n";
import { SkeletonPage } from "@/components/ui/skeleton";
import { PageHeaderSkeleton, KpiCardsSkeleton, ChartSkeleton, TableSkeleton } from "@/components/skeletons";

export default async function Loading() {
  const t = await getT();
  return (
    <SkeletonPage label={t.common.loadingEllipsis}>
      <PageHeaderSkeleton withAction />
      <KpiCardsSkeleton count={8} />
      <KpiCardsSkeleton count={6} />
      <ChartSkeleton />
      <TableSkeleton />
    </SkeletonPage>
  );
}
