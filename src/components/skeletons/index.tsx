import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Page header                                                                */
/* -------------------------------------------------------------------------- */

export function PageHeaderSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48 sm:w-56" />
        <Skeleton className="h-4 w-64 sm:w-80" />
      </div>
      {withAction && <Skeleton className="h-9 w-32 rounded-lg" />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  KPI cards                                                                  */
/* -------------------------------------------------------------------------- */

export function KpiCardsSkeleton({
  count = 4,
  className = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-14" />
            </div>
            <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Table                                                                      */
/* -------------------------------------------------------------------------- */

export function TableSkeleton({
  rows = 8,
  cols = 5,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {/* header */}
      <div
        className="grid gap-3 border-b border-border bg-muted/40 px-3 py-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3.5 w-16" />
        ))}
      </div>
      {/* body */}
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="grid items-center gap-3 px-3 py-3.5"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton
                key={c}
                className={cn("h-4", c === 0 ? "w-28" : c === cols - 1 ? "w-10 justify-self-end" : "w-20")}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Card grid (departments, shifts)                                            */
/* -------------------------------------------------------------------------- */

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardContent className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((_, j) => (
                <Skeleton key={j} className="h-16 rounded-lg" />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Chart                                                                      */
/* -------------------------------------------------------------------------- */

export function ChartSkeleton({ title = true }: { title?: boolean }) {
  return (
    <Card>
      {title && (
        <CardHeader>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </CardHeader>
      )}
      <CardContent>
        <div className="flex h-[220px] items-end gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton
              key={i}
              className="w-full rounded-t-md"
              style={{ height: `${30 + ((i * 37) % 65)}%` }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Ranked list (top-late employees / departments)                             */
/* -------------------------------------------------------------------------- */

export function ListSkeleton({ rows = 5, title = true }: { rows?: number; title?: boolean }) {
  return (
    <Card>
      {title && (
        <CardHeader>
          <Skeleton className="h-4 w-44" />
        </CardHeader>
      )}
      <CardContent className="flex flex-col gap-1">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between border-b border-border py-2.5 last:border-0"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-6 w-6 rounded-full" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tabs bar                                                                   */
/* -------------------------------------------------------------------------- */

export function TabsSkeleton({ tabs = 4 }: { tabs?: number }) {
  return (
    <div className="flex w-fit gap-1 rounded-lg bg-muted p-1">
      {Array.from({ length: tabs }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-24 rounded-md bg-background/60" />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Form (settings)                                                            */
/* -------------------------------------------------------------------------- */

export function FormSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-5">
        <Skeleton className="h-5 w-40" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
          ))}
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Employee profile / details                                                 */
/* -------------------------------------------------------------------------- */

export function DetailsSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-32" />

      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3.5 w-52" />
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-24" />
            ))}
          </div>
        </CardContent>
      </Card>

      <TabsSkeleton tabs={6} />

      <Card>
        <CardContent className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
