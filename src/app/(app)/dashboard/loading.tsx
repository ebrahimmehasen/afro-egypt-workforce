import { getT } from "@/lib/i18n";
import { SkeletonPage } from "@/components/ui/skeleton";
import {
  PageHeaderSkeleton,
  KpiCardsSkeleton,
  ChartSkeleton,
  ListSkeleton,
} from "@/components/skeletons";

export default async function Loading() {
  const t = await getT();
  return (
    <SkeletonPage label={t.common.loadingEllipsis}>
      <PageHeaderSkeleton />
      <KpiCardsSkeleton count={6} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" />
      <KpiCardsSkeleton count={4} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
      <ListSkeleton rows={5} />
    </SkeletonPage>
  );
}
