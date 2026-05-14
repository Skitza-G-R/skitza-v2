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
        theme="dark"
        toastOptions={{
          duration: 3000,
          classNames: {
            toast: [
              "!bg-[rgb(var(--bg-sidebar))]",
              "!border !border-[rgb(255_255_255/0.08)]",
              "!text-[rgb(255_255_255/0.95)]",
              "!rounded-[var(--radius-md)]",
              "!shadow-[0_8px_24px_-6px_rgba(0,0,0,0.45),0_2px_6px_-2px_rgba(0,0,0,0.30)]",
              "!font-mono !text-[13px]",
              "sk-toast-in",
            ].join(" "),
            title: "!font-medium !tracking-tight !text-[rgb(255_255_255/0.95)]",
            description: "!text-[rgb(255_255_255/0.65)]",
            success: [
              "!border-[rgb(var(--brand-primary)/0.55)]",
              "!bg-[rgb(var(--bg-sidebar))]",
            ].join(" "),
            error: [
              "!border-[rgb(var(--fg-danger)/0.6)]",
              "!bg-[rgb(var(--bg-sidebar))]",
              "!text-[rgb(255_255_255/0.95)]",
            ].join(" "),
            actionButton: [
              "!font-bold",
              "!text-[rgb(var(--brand-primary))]",
              "!bg-transparent",
              "hover:!bg-[rgb(255_255_255/0.05)]",
              "!px-2 !py-1 !rounded-[6px]",
            ].join(" "),
            cancelButton: [
              "!font-medium",
              "!text-[rgb(255_255_255/0.55)]",
              "!bg-transparent",
            ].join(" "),
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
