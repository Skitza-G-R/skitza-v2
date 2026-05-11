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

interface ToastOptions {
  durationMs?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toast: (
    message: string,
    variant?: ToastVariant,
    options?: ToastOptions,
  ) => void;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SonnerToaster
        position="bottom-center"
        offset={16}
        gap={8}
        theme="light"
        toastOptions={{
          duration: 3000,
          classNames: {
            toast: [
              "!bg-[rgb(var(--bg-elevated))]",
              "!border !border-[rgb(var(--border-subtle))]",
              "!text-[rgb(var(--fg-default))]",
              "!rounded-[var(--radius-md)]",
              "!shadow-[var(--shadow-md)]",
              "!font-mono !text-[13px]",
              "sk-toast-in",
            ].join(" "),
            title: "!font-medium !tracking-tight !text-[rgb(var(--fg-default))]",
            description: "!text-[rgb(var(--fg-muted))]",
            success: [
              "!border-[rgb(var(--brand-primary)/0.5)]",
              "!bg-[rgb(var(--brand-primary)/0.10)]",
            ].join(" "),
            error: [
              "!border-[rgb(var(--fg-danger)/0.5)]",
              "!bg-[rgb(var(--fg-danger)/0.10)]",
              "!text-[rgb(var(--fg-default))]",
            ].join(" "),
            actionButton:
              "!font-bold !text-[rgb(var(--brand-primary))] !bg-transparent",
            cancelButton:
              "!font-medium !text-[rgb(var(--fg-muted))] !bg-transparent",
          },
        }}
      />
    </>
  );
}

export function useToast(): ToastContextValue {
  return {
    toast: (message, variant = "info", options) => {
      const sonnerOptions: Parameters<typeof sonnerToast>[1] = {};
      if (options?.durationMs != null) {
        sonnerOptions.duration = options.durationMs;
      }
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
