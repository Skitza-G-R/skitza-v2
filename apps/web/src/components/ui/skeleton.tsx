import { cn } from "~/lib/cn";

// Shimmer via background-position animation on a linear gradient.
// Prefers-reduced-motion falls back to a static tinted block.
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-[var(--radius-md)] bg-[rgb(var(--bg-elevated))]",
        "motion-safe:bg-gradient-to-r motion-safe:from-[rgb(var(--bg-elevated))] motion-safe:via-[rgb(var(--bg-overlay))] motion-safe:to-[rgb(var(--bg-elevated))]",
        "motion-safe:bg-[length:200%_100%]",
        "motion-safe:[animation:skitza-shimmer_1.4s_ease-in-out_infinite]",
        className,
      )}
    />
  );
}
