import { getT } from "@/lib/i18n";
import { SkeletonPage } from "@/components/ui/skeleton";
import { PageHeaderSkeleton, TabsSkeleton, TableSkeleton } from "@/components/skeletons";

export default async function Loading() {
  const t = await getT();
  return (
    <SkeletonPage label={t.common.loadingEllipsis}>
      <PageHeaderSkeleton />
      <TabsSkeleton tabs={4} />
      <TableSkeleton rows={10} cols={6} />
    </SkeletonPage>
  );
}
