"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
} from "react";

import { cn } from "~/lib/cn";

// Tooltip — locked design system (v3-ui-design, Phase 5).
//
// Visual contract per `notes/skitza-context.txt` deferred-primitives
// table: dark sidebar surface + inverse text + 8px radius + fast
// 100ms fade-in. The dark surround makes the floating caption read as
// chrome, not content.
//
// API mirrors shadcn/ui: wrap the page in `<TooltipProvider>` once,
// then `<Tooltip><TooltipTrigger asChild>…</TooltipTrigger><TooltipContent>…</TooltipContent></Tooltip>`
// at every consumer. `delayDuration` defaults to 200ms (snappier than
// Radix's 700ms default — feels right for amber chips + lock icons).
//
// Reduce-motion: `.sk-tooltip-enter` is gated in globals.css so the
// 100ms fade collapses to instant for users who opt out of motion.

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;
const TooltipPortal = TooltipPrimitive.Portal;

const TooltipContent = forwardRef<
  ComponentRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPortal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        // Surface — dark chrome with inverse text
        "z-50 max-w-[260px] rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sidebar))] px-2.5 py-1.5",
        "text-xs font-medium leading-tight text-[rgb(var(--fg-inverse))]",
        "shadow-[var(--shadow-md)]",
        // Entrance — fast fade per locked spec, gated in globals.css
        "sk-tooltip-enter",
        // Pointer-events-none so the tooltip never steals hover from
        // the trigger (fixes flickering with adjacent items).
        "pointer-events-none",
        className,
      )}
      {...props}
    />
  </TooltipPortal>
));
TooltipContent.displayName = "TooltipContent";

export {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
};
