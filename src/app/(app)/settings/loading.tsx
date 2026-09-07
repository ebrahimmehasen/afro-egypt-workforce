import { getT } from "@/lib/i18n";
import { SkeletonPage, Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeaderSkeleton, FormSkeleton } from "@/components/skeletons";

export default async function Loading() {
  const t = await getT();
  return (
    <SkeletonPage label={t.common.loadingEllipsis}>
      <PageHeaderSkeleton />
      <Card>
        <CardContent className="flex items-center gap-4 p-5">
          <Skeleton className="h-16 w-16 rounded-lg" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        </CardContent>
      </Card>
      <FormSkeleton rows={4} />
      <FormSkeleton rows={4} />
      <FormSkeleton rows={2} />
    </SkeletonPage>
  );
}
