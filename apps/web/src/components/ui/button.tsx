import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "~/lib/cn";

// Button — locked design system (v3-ui-design).
//
// `default` is the amber CTA. `dark` is the sidebar-coloured CTA used on
// the public link strip and "Book a session" Hero. `secondary` / `outline`
// / `ghost` cover the workspace's quieter affordances.
//
// `.sk-press` (defined in globals.css) gives every variant the locked
// design's tactile feedback: brightness +5% on hover (devices that
// support hover) and scale(0.94) on :active. `:focus-visible` paints the
// keyboard ring, never the click ring.
const buttonVariants = cva(
  [
    "sk-press",
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-[var(--radius-md)]",
    "text-sm font-bold tracking-tight",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-background))]",
    "disabled:pointer-events-none disabled:opacity-40",
    "select-none",
  ].join(" "),
  {
    variants: {
      variant: {
        // Amber CTA — primary affordance. Subtle inner highlight gives
        // depth without competing with the warm-cream surface.
        default: [
          "bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))]",
          "shadow-[0_2px_12px_rgb(var(--brand-primary)/0.25)]",
          "hover:shadow-[0_6px_20px_rgb(var(--brand-primary)/0.35)]",
        ].join(" "),
        // Dark CTA — sidebar-black. Used for "Book a session" on the
        // artist-facing Hero strip and the dark portion of the public
        // link block.
        dark: [
          "bg-[rgb(var(--bg-sidebar))] text-[rgb(var(--fg-inverse))]",
          "shadow-[0_2px_12px_rgb(17_16_9_/_0.20)]",
          "hover:shadow-[0_6px_20px_rgb(17_16_9_/_0.30)]",
        ].join(" "),
        // Secondary — elevated surface with a hairline border.
        secondary: [
          "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))]",
          "border border-[rgb(var(--border-subtle))]",
          "hover:bg-[rgb(var(--bg-overlay))] hover:border-[rgb(var(--border-strong))]",
        ].join(" "),
        // Outline — transparent fill, used on elevated surfaces where
        // a Secondary's white-on-white would disappear.
        outline: [
          "bg-transparent text-[rgb(var(--fg-default))]",
          "border border-[rgb(var(--border-subtle))]",
          "hover:bg-[rgb(var(--bg-elevated))] hover:border-[rgb(var(--border-strong))]",
        ].join(" "),
        ghost:
          "bg-transparent text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-elevated))]",
        destructive: [
          "bg-transparent text-[rgb(var(--fg-danger))]",
          "border border-[rgb(var(--border-subtle))]",
          "hover:bg-[rgb(var(--fg-danger)/0.08)] hover:border-[rgb(var(--fg-danger)/0.4)]",
        ].join(" "),
        link:
          "bg-transparent underline-offset-4 hover:underline text-[rgb(var(--brand-primary))] px-0",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-6 text-base",
        xl: "h-14 px-8 text-base",
        icon: "h-10 w-10 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
