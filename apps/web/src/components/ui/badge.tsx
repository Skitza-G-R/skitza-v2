import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "~/lib/cn";

// Status pill — locked design system (v3-ui-design).
//
// Tinted background + matching-hue hairline; mirrors the `.pill` family
// in globals.css. 10px bold uppercase tracking-widest matches the
// design-system.md spec for "section labels / status pills".
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[var(--radius-lg)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral:
          "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))] border border-[rgb(var(--border-subtle))]",
        active:
          "bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))] border border-[rgb(var(--brand-primary)/0.25)]",
        warning:
          "bg-[rgb(var(--fg-warning)/0.10)] text-[rgb(var(--fg-warning))] border border-[rgb(var(--fg-warning)/0.20)]",
        danger:
          "bg-[rgb(var(--fg-danger)/0.10)] text-[rgb(var(--fg-danger))] border border-[rgb(var(--fg-danger)/0.20)]",
        success:
          "bg-[rgb(var(--fg-success)/0.10)] text-[rgb(var(--fg-success))] border border-[rgb(var(--fg-success)/0.22)]",
        accent:
          "bg-[rgb(var(--brand-copper)/0.12)] text-[rgb(var(--brand-copper))] border border-[rgb(var(--brand-copper)/0.35)]",
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
            variant === "success" && "bg-[rgb(var(--fg-success))]",
            variant === "accent" && "bg-[rgb(var(--brand-copper))]",
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
