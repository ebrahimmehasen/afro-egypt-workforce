import { getT } from "@/lib/i18n";
import { SkeletonPage } from "@/components/ui/skeleton";
import { PageHeaderSkeleton, TableSkeleton } from "@/components/skeletons";

export default async function Loading() {
  const t = await getT();
  return (
    <SkeletonPage label={t.common.loadingEllipsis}>
      <PageHeaderSkeleton />
      <TableSkeleton rows={12} cols={6} />
    </SkeletonPage>
  );
}
