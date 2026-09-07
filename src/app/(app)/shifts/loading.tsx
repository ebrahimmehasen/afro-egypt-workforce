import { getT } from "@/lib/i18n";
import { SkeletonPage } from "@/components/ui/skeleton";
import { PageHeaderSkeleton, CardGridSkeleton } from "@/components/skeletons";

export default async function Loading() {
  const t = await getT();
  return (
    <SkeletonPage label={t.common.loadingEllipsis}>
      <PageHeaderSkeleton withAction />
      <CardGridSkeleton count={6} />
    </SkeletonPage>
  );
}
