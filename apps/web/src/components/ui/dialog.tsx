"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type HTMLAttributes,
} from "react";

import { cn } from "~/lib/cn";

// Dialog — locked design system (v3-ui-design).
//
// Radix-backed shadcn/ui convention: `<Dialog>` (Root), `<DialogTrigger>`,
// `<DialogContent>` (auto-portals + overlays itself), and the
// `<DialogHeader>` / `<DialogFooter>` / `<DialogTitle>` /
// `<DialogDescription>` / `<DialogClose>` semantic helpers.
//
// Visual contract:
// - Surface: `bg-elevated` (#FFFFFF) with `border-subtle` hairline,
//   `--shadow-lg` elevation, `--radius-lg` corners on desktop.
// - Backdrop: warm-near-black at 45% alpha + a subtle blur. Uses the
//   `--bg-sidebar` triple so the overlay reads as the same warm dark
//   the sidebar already establishes (no off-the-shelf `rgba(0,0,0,…)`).
// - Entrance: `.sk-dialog-enter` (defined in globals.css) — slide-up
//   from bottom under 640px, scale-in centered at ≥640px. Reduce-motion
//   gated.
//
// Mobile presentation is a bottom-sheet (full-bleed bottom-anchored,
// `rounded-t-xl`, `max-h-[90vh]`); desktop centers via the standard
// `top-1/2 left-1/2 -translate-…` shadcn pattern. The single CSS
// utility `.sk-dialog-enter` flips animation by viewport so the JSX
// stays clean.

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = forwardRef<
  ComponentRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-[rgb(var(--bg-sidebar)/0.45)] backdrop-blur-sm",
      "data-[state=open]:animate-[skitza-reveal-up_240ms_cubic-bezier(0.16,1,0.3,1)_both]",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = "DialogOverlay";

const DialogContent = forwardRef<
  ComponentRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Surface tokens
        "fixed z-50 grid gap-4 border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-lg)]",
        // Mobile bottom-sheet layout
        "inset-x-0 bottom-0 max-h-[90vh] w-full rounded-t-[var(--radius-xl)] p-6",
        // Desktop centered modal layout
        "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-lg)]",
        // Entrance — `.sk-dialog-enter` switches animation by viewport
        // (slide-up <640px, pop-center ≥640px). Reduce-motion gated.
        "sk-dialog-enter",
        // Focus ring stays inside the surface for keyboard users
        "focus:outline-none",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className={cn(
          "absolute right-4 top-4 rounded-[var(--radius-sm)] p-1",
          "text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))]",
          "sk-press",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))]",
        )}
      >
        {/* Inline X — avoids pulling in lucide-react for a single icon. */}
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = "DialogContent";

const DialogHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1.5 text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = forwardRef<
  ComponentRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      // Syne for editorial weight — same family as Card titles.
      "font-display text-lg font-bold leading-tight tracking-tight text-[rgb(var(--fg-default))]",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

const DialogDescription = forwardRef<
  ComponentRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-[rgb(var(--fg-muted))]", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
