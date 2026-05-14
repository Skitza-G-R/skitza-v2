import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "~/lib/cn";

// Card — locked design system (v3-ui-design).
//
// `bg-elevated` (#FFFFFF) on the warm-cream canvas, `border-subtle`
// hairline (#E8E1D4), `--radius-lg` (16px) — matches the .surface-card
// utility in globals.css and the design-system.md spec verbatim.
//
// `interactive`: opt-in `.sk-lift` (-1px translate + soft md shadow) for
// cards that wrap a button or link. Static cards stay inert; lifting
// non-interactive content reads as a lie about affordance.
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** When true, adds the sk-lift hover affordance. Use for tappable cards. */
  interactive?: boolean;
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]",
        "shadow-[var(--shadow-sm)]",
        interactive && "sk-lift",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col gap-1.5 px-[18px] pt-[18px] pb-3",
        className,
      )}
      {...props}
    />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = forwardRef<HTMLDivElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn(
        // Syne for headings per the locked spec — extrabold + tight tracking.
        "font-display text-[15px] font-bold leading-none tracking-[-0.01em] text-[rgb(var(--fg-default))]",
        className,
      )}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn("text-[13px] text-[rgb(var(--fg-muted))]", className)}
      {...props}
    />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("px-[18px] pb-[18px] pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center px-[18px] pb-[18px] pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
