import type { ReactNode } from "react";

import { cn } from "~/lib/cn";

// Empty state — shown in place of content when there's nothing yet.
// Deliberately warm copy over lifeless "No data". Optional CTA.
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        "rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))]",
        "bg-[rgb(var(--bg-sunken))] px-6 py-12",
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))]">
          {icon}
        </div>
      ) : null}
      <h3 className="font-display text-xl text-[rgb(var(--fg-primary))]">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-sm text-sm text-[rgb(var(--fg-secondary))]">{description}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
