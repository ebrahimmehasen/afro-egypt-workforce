import { cn } from "@/lib/utils";

/**
 * A single shimmering placeholder block. Uses Tailwind's `animate-pulse`,
 * which is automatically disabled by the `motion-reduce:animate-none` variant
 * for users who prefer reduced motion.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

/**
 * Wraps a full-page skeleton. Announces the loading state to assistive tech
 * (`role="status"` + `aria-busy`) and carries a visually-hidden label.
 */
export function SkeletonPage({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" className={cn("flex flex-col gap-6", className)}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
