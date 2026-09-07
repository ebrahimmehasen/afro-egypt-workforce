import { getT } from "@/lib/i18n";
import { SkeletonPage } from "@/components/ui/skeleton";
import { PageHeaderSkeleton, KpiCardsSkeleton, ChartSkeleton, ListSkeleton } from "@/components/skeletons";

export default async function Loading() {
  const t = await getT();
  return (
    <SkeletonPage label={t.common.loadingEllipsis}>
      <PageHeaderSkeleton />
      <KpiCardsSkeleton count={4} />
      <ChartSkeleton />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ListSkeleton rows={5} />
        <ListSkeleton rows={5} />
      </div>
    </SkeletonPage>
  );
}
