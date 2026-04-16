import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "~/lib/cn";

// Status pill. Each variant uses a tinted background + a hairline border of
// the same hue — reads cleaner than solid fills against the dark workspace.
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.68rem] font-medium uppercase tracking-[0.1em] whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral:
          "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))] border border-[rgb(var(--border-subtle))]",
        active:
          "bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))] border border-[rgb(var(--brand-primary)/0.35)]",
        warning:
          "bg-[rgb(var(--fg-warning)/0.12)] text-[rgb(var(--fg-warning))] border border-[rgb(var(--fg-warning)/0.35)]",
        danger:
          "bg-[rgb(var(--fg-danger)/0.12)] text-[rgb(var(--fg-danger))] border border-[rgb(var(--fg-danger)/0.35)]",
        accent:
          "bg-[rgb(var(--brand-accent)/0.12)] text-[rgb(var(--brand-accent))] border border-[rgb(var(--brand-accent)/0.35)]",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, dot, children, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? (
        <span
          aria-hidden
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            variant === "active" && "bg-[rgb(var(--brand-primary))]",
            variant === "warning" && "bg-[rgb(var(--fg-warning))]",
            variant === "danger" && "bg-[rgb(var(--fg-danger))]",
            variant === "accent" && "bg-[rgb(var(--brand-accent))]",
            (variant === "neutral" || !variant) && "bg-[rgb(var(--fg-muted))]",
          )}
        />
      ) : null}
      {children}
    </span>
  ),
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
