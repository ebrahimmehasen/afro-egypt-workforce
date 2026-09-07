import { getT } from "@/lib/i18n";
import { SkeletonPage, Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton, KpiCardsSkeleton, TabsSkeleton, TableSkeleton } from "@/components/skeletons";

export default async function Loading() {
  const t = await getT();
  return (
    <SkeletonPage label={t.common.loadingEllipsis}>
      <PageHeaderSkeleton withAction />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-9 w-56 rounded-lg" />
        <KpiCardsSkeleton count={5} className="grid grid-cols-3 gap-2 sm:flex sm:gap-3" />
      </div>
      <TabsSkeleton tabs={2} />
      <TableSkeleton rows={10} cols={6} />
    </SkeletonPage>
  );
}
