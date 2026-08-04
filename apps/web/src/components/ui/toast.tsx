"use client";

import type { ReactNode } from "react";
import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";

// Toast — locked design system (v3-ui-design). Backed by sonner.
//
// The prior implementation was a hand-rolled context + queue + timer
// system (apps/web/src/components/ui/toast.tsx, retired here). Sonner
// gives us the same `useToast()` ergonomics plus collision-free
// stacking, pause-on-hover, accessibility roles, and a 5kb footprint.
//
// Public API stays IDENTICAL so the ~30 existing call-sites
// (`const { toast } = useToast(); toast("Saved", "success")`) keep
// working. Variants `success | info | error` map to sonner's typed
// helpers internally.
//
// Theming hooks into the new tokens via `toastOptions.classNames`. The
// `!` prefix on each utility uses Tailwind's `!important` modifier so
// the override beats sonner's default inline class styling. The
// container picks up `.sk-toast-in` for the entrance animation that
// matches the rest of the system (gated under prefers-reduced-motion
// in globals.css).

type ToastVariant = "success" | "info" | "error";

const DEFAULT_TOAST_DURATION_MS = 3600;
const ERROR_TOAST_DURATION_MS = 7000;

interface ToastOptions {
  durationMs?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant, options?: ToastOptions) => void;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SonnerToaster
        position="top-center"
        offset={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
        mobileOffset={{
          top: "calc(env(safe-area-inset-top) + 10px)",
          right: 12,
          left: 12,
        }}
        gap={8}
        visibleToasts={2}
        expand={false}
        closeButton
        theme="system"
        toastOptions={{
          duration: DEFAULT_TOAST_DURATION_MS,
          closeButtonAriaLabel: "Dismiss message",
          classNames: {
            toast: [
              "!w-[min(22rem,calc(100vw-2rem))] !min-h-0",
              "!border !border-[rgb(var(--border-subtle))]",
              "!bg-[rgb(var(--bg-elevated))]",
              "!px-3.5 !py-2.5 !pr-10",
              "!text-[rgb(var(--fg-default))]",
              "!rounded-[var(--radius-md)]",
              "!shadow-[0_10px_28px_-14px_rgb(0_0_0/0.34)]",
              "!text-sm",
              "sk-toast-in",
            ].join(" "),
            title: "!font-medium !leading-5 !tracking-tight !text-[rgb(var(--fg-default))]",
            description: "!text-[rgb(var(--fg-muted))]",
            success: [
              "!border-[rgb(var(--brand-primary)/0.55)]",
              "!bg-[rgb(var(--bg-elevated))]",
            ].join(" "),
            error: [
              "!border-[rgb(var(--fg-danger)/0.6)]",
              "!bg-[rgb(var(--bg-elevated))]",
              "!text-[rgb(var(--fg-default))]",
            ].join(" "),
            closeButton: [
              "!size-8 !rounded-full",
              "!border-[rgb(var(--border-subtle))]",
              "!bg-[rgb(var(--bg-elevated))]",
              "!text-[rgb(var(--fg-muted))]",
              "hover:!text-[rgb(var(--fg-default))]",
              "focus-visible:!ring-2 focus-visible:!ring-[rgb(var(--brand-primary))]",
            ].join(" "),
            actionButton: [
              "!min-h-8 !font-bold",
              "!text-[rgb(var(--brand-primary))]",
              "!bg-transparent",
              "hover:!bg-[rgb(var(--bg-sunken))]",
              "!px-2.5 !py-1 !rounded-[var(--radius-sm)]",
            ].join(" "),
            cancelButton: ["!font-medium", "!text-[rgb(var(--fg-muted))]", "!bg-transparent"].join(
              " ",
            ),
          },
        }}
      />
    </>
  );
}

export function useToast(): ToastContextValue {
  return {
    toast: (message, variant = "info", options) => {
      const sonnerOptions: Parameters<typeof sonnerToast>[1] = {
        duration:
          options?.durationMs ??
          (variant === "error" ? ERROR_TOAST_DURATION_MS : DEFAULT_TOAST_DURATION_MS),
      };
      if (options?.action != null) {
        sonnerOptions.action = {
          label: options.action.label,
          onClick: options.action.onClick,
        };
      }
      if (variant === "success") {
        sonnerToast.success(message, sonnerOptions);
      } else if (variant === "error") {
        sonnerToast.error(message, sonnerOptions);
      } else {
        sonnerToast(message, sonnerOptions);
      }
    },
  };
}
