import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "~/lib/cn";

// Base: keyboard-accessible, momentum-feel transitions (not "spring", not "ease-in").
// Active state uses translate-y to give a physical keypress feel — a nod to
// outboard gear knobs and buttons this tool sits alongside on a producer's desk.
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)]",
    "text-sm font-medium tracking-tight",
    "transition-[background-color,border-color,color,transform,box-shadow] duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
    "disabled:pointer-events-none disabled:opacity-40",
    "active:translate-y-[1px]",
    "select-none",
  ].join(" "),
  {
    variants: {
      variant: {
        // Primary — the signal-green CTA. Subtle inner highlight for depth.
        default: [
          "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))]",
          "shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.15),0_1px_2px_0_rgb(0_0_0_/_0.4)]",
          "hover:brightness-[1.06] hover:shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.2),0_2px_8px_-1px_rgb(var(--brand-primary)/0.35)]",
        ].join(" "),
        // Secondary — glass-elevated, hairline border. The "room" button.
        secondary: [
          "bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-primary))]",
          "border border-[rgb(var(--border-subtle))]",
          "hover:bg-[rgb(var(--bg-overlay))] hover:border-[rgb(var(--border-strong))]",
        ].join(" "),
        // Outline — like secondary but transparent; used when sitting on elevated surfaces.
        outline: [
          "bg-transparent text-[rgb(var(--fg-primary))]",
          "border border-[rgb(var(--border-subtle))]",
          "hover:bg-[rgb(var(--bg-elevated))] hover:border-[rgb(var(--border-strong))]",
        ].join(" "),
        ghost: "bg-transparent text-[rgb(var(--fg-primary))] hover:bg-[rgb(var(--bg-elevated))]",
        destructive: [
          "bg-transparent text-[rgb(var(--fg-danger))]",
          "border border-[rgb(var(--border-subtle))]",
          "hover:bg-[rgb(var(--fg-danger)/0.08)] hover:border-[rgb(var(--fg-danger)/0.4)]",
        ].join(" "),
        link: "bg-transparent underline-offset-4 hover:underline text-[rgb(var(--brand-primary))] px-0",
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
