import { getT } from "@/lib/i18n";
import { SkeletonPage } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton, TableSkeleton } from "@/components/skeletons";

export default async function Loading() {
  const t = await getT();
  return (
    <SkeletonPage label={t.common.loadingEllipsis}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeaderSkeleton />
        <Skeleton className="h-9 w-44 rounded-lg" />
      </div>
      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-9 w-40 rounded-lg" />
        </CardContent>
      </Card>
      <TableSkeleton rows={10} cols={8} />
    </SkeletonPage>
  );
}
