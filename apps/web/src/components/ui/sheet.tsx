"use client";

import * as SheetPrimitive from "@radix-ui/react-dialog";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type HTMLAttributes,
} from "react";

import { cn } from "~/lib/cn";

// Sheet — locked design system (v3-ui-design).
//
// Mobile-first bottom-anchored sheet with optional `side="right"`
// desktop drawer variant. Built on @radix-ui/react-dialog (already
// a Skitza dep) — same Radix primitive Dialog uses, but tuned for
// longer-lived flows like booking review, store filters, and version
// history where the sheet feels persistent rather than modal.
//
// Visual contract:
// - Surface: `bg-elevated` with `border-subtle` hairline,
//   `--shadow-lg` elevation. Bottom variant gets `--radius-xl` top
//   corners; right variant gets `--radius-lg` left corners on sm+.
// - Backdrop: warm-near-black at 45% alpha + subtle blur (matches
//   the Dialog overlay so both primitives read as the same surface
//   family).
// - Drag handle: a 40×4px pill rendered at the top of the sheet on
//   bottom variants. The design drop's distinctive affordance —
//   makes the bottom-sheet look "draggable" even when dismissal is
//   actually via overlay tap or programmatic close.
// - Entrance: `.sk-sheet-enter` (defined in globals.css, line ~625)
//   picks the keyframe per `data-side`: `skitza-slide-up-modal` for
//   bottom, `skitza-slide-in-right` for right. Reduce-motion gated.
//
// API parity with shadcn/ui's Sheet — drop-in replacement if Phase 5
// imports compose against the same export names.
//
// Phase 4 + 5 first consumers (planned):
//   - ReviewModal in /dashboard/calendar (booking accept/decline)
//   - Filter sheets on /artist/store + /artist/book
//
// Side variants beyond `bottom` and `right` (left, top) are NOT
// implemented yet — add them in the phase that needs them, with a
// matching keyframe in globals.css and a matching reduce-gate entry.

type SheetSide = "bottom" | "right";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetPortal = SheetPrimitive.Portal;
const SheetClose = SheetPrimitive.Close;

const SheetOverlay = forwardRef<
  ComponentRef<typeof SheetPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-[rgb(var(--bg-sidebar)/0.45)] backdrop-blur-sm",
      "data-[state=open]:animate-[skitza-reveal-up_240ms_cubic-bezier(0.16,1,0.3,1)_both]",
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = "SheetOverlay";

interface SheetContentProps
  extends ComponentPropsWithoutRef<typeof SheetPrimitive.Content> {
  side?: SheetSide;
  showHandle?: boolean;
}

const SheetContent = forwardRef<
  ComponentRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ className, children, side = "bottom", showHandle, ...props }, ref) => {
  // Drag handle is the design drop's distinctive bottom-sheet
  // affordance. Default ON for `bottom`, OFF for `right` (desktop
  // drawer pattern doesn't need it).
  const handle = showHandle ?? side === "bottom";

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        data-side={side}
        className={cn(
          // Shared surface tokens
          "fixed z-50 flex flex-col gap-4 border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-lg)]",
          // Side-specific layout
          side === "bottom" &&
            "inset-x-0 bottom-0 max-h-[88vh] w-full rounded-t-[var(--radius-xl)] p-4 pb-6 sm:p-6",
          side === "right" &&
            "inset-y-0 right-0 h-full w-full max-w-md p-6 sm:rounded-l-[var(--radius-lg)]",
          // Entrance per data-side. Reduce-motion gated in CSS.
          "sk-sheet-enter",
          // Keyboard focus stays inside the surface
          "focus:outline-none",
          className,
        )}
        {...props}
      >
        {handle && (
          <div
            aria-hidden
            className="mx-auto -mt-1 h-1 w-10 shrink-0 rounded-full bg-[rgb(var(--border-subtle))]"
          />
        )}
        {children}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = "SheetContent";

const SheetHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1.5 text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      className,
    )}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = forwardRef<
  ComponentRef<typeof SheetPrimitive.Title>,
  ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn(
      // Syne for editorial weight — same family as Dialog title.
      "font-display text-lg font-bold leading-tight tracking-tight text-[rgb(var(--fg-default))]",
      className,
    )}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = forwardRef<
  ComponentRef<typeof SheetPrimitive.Description>,
  ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-[rgb(var(--fg-muted))]", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
export type { SheetContentProps, SheetSide };
