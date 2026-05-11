// editor-shell.tsx
//
// Modal chrome for the producer Store wizard (Phase 2). Wraps the active
// step body with a sticky header (close X on LEFT, then step label +
// title + subtitle + StepBar stacked beside it) and footer (Back ·
// Continue/Save). Uses Radix Dialog for portal/scrim/focus so the shell
// stays a pure layout shell.
//
// Mirrors the Phase 1 store-screen modal sizing/positioning but adds the
// design-brief popIn entrance (scale 0.97 → 1, translateY(12) → 0,
// 240ms cubic-bezier(.16,1,.3,1)). The keyframe is inlined via a single
// <style> element because the codebase has no `<style jsx global>`
// pattern; the existing `skitza-pop-in` keyframe in globals.css uses
// scale(0.96) without translateY so it doesn't match the brief.
//
// Layout matches the storefront.html prototype: X on the LEFT (circular
// 32×32 ghost button), title row vertically centered with X. Step bar
// renders as discrete dashes (see step-bar.tsx). Cancel button removed
// from footer — the Close X handles cancel.

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { StepBar } from "./step-bar";

interface EditorShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "new" | "edit";
  productName?: string;
  steps: readonly string[];
  current: string;
  title: string;
  subtitle?: string;
  canContinue: boolean;
  onBack: () => void;
  onContinue: () => void;
  onSave: () => void;
  isLastStep: boolean;
  isFirstStep: boolean;
  children: ReactNode;
  pending?: boolean;
}

export function EditorShell({
  open,
  onOpenChange,
  mode,
  productName,
  steps,
  current,
  title,
  subtitle,
  canContinue,
  onBack,
  onContinue,
  onSave,
  isLastStep,
  isFirstStep,
  children,
  pending = false,
}: EditorShellProps) {
  const currentIdx = Math.max(0, steps.indexOf(current));
  const currentNum = String(currentIdx + 1);
  const totalNum = String(steps.length);
  const stepLabel =
    mode === "new"
      ? `Step ${currentNum} of ${totalNum} · NEW PRODUCT`
      : `Step ${currentNum} of ${totalNum} · EDITING · ${
          productName ?? "product"
        }`;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault();
          }}
          aria-label={mode === "new" ? "New product" : `Edit ${productName ?? "product"}`}
          style={{ animation: "popIn 240ms cubic-bezier(.16,1,.3,1)" }}
          className="fixed z-50 flex flex-col overflow-hidden bg-[rgb(var(--surface-card))] shadow-2xl
            inset-x-0 bottom-0 max-h-[90vh] rounded-t-[var(--radius-xl)]
            sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2
            sm:w-[calc(100vw-3rem)] sm:max-w-[640px] sm:max-h-[calc(100vh-3rem)]
            sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[18px]"
        >
          {/* Inline keyframe — see file-level comment for rationale. */}
          <style>{`@keyframes popIn {
            from { opacity: 0; transform: translate(-50%, calc(-50% + 12px)) scale(0.97); }
            to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          }
          @media (max-width: 639px) {
            @keyframes popIn {
              from { opacity: 0; transform: translateY(12px) scale(0.97); }
              to   { opacity: 1; transform: translateY(0) scale(1); }
            }
          }`}</style>

          {/* Header — X on LEFT, title block to its right (vertically centered with X). */}
          <div className="border-b border-[rgb(var(--border-subtle))] px-6 pb-[18px] pt-[20px]">
            <div className="flex items-center gap-3">
              <DialogPrimitive.Close
                aria-label="Close"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[rgb(var(--text-muted))] transition-colors hover:bg-[rgb(var(--surface-hover))] hover:text-[rgb(var(--text-strong))]"
              >
                <X className="h-4 w-4" aria-hidden />
              </DialogPrimitive.Close>
              <div className="min-w-0 flex-1">
                <span
                  className="block font-[var(--font-outfit)] text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--text-muted))]"
                >
                  {stepLabel}
                </span>
                <DialogPrimitive.Title
                  className="mt-1 font-[var(--font-syne)] font-extrabold leading-none tracking-[-0.025em] text-[rgb(var(--text-strong))]"
                  style={{ fontSize: "clamp(22px, 4vw, 28px)" }}
                >
                  {title}
                </DialogPrimitive.Title>
                {subtitle ? (
                  <DialogPrimitive.Description className="mt-1.5 truncate text-[13px] leading-snug text-[rgb(var(--text-muted))]">
                    {subtitle}
                  </DialogPrimitive.Description>
                ) : null}
              </div>
            </div>
            <div className="mt-[18px]">
              <StepBar steps={steps} current={current} />
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>

          {/* Footer — Back on left, Continue/Save on right. Cancel removed: Close X handles it. */}
          <div className="flex items-center justify-between gap-2 border-t border-[rgb(var(--border-subtle))] px-6 py-4">
            <div>
              {isFirstStep ? null : (
                <button
                  type="button"
                  onClick={onBack}
                  className="inline-flex h-9 items-center rounded-full px-3 text-[13px] font-medium text-[rgb(var(--text-muted))] transition-colors hover:bg-[rgb(var(--surface-hover))] hover:text-[rgb(var(--text-strong))]"
                >
                  ← Back
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isLastStep ? (
                <button
                  type="button"
                  onClick={onSave}
                  disabled={!canContinue || pending}
                  className="inline-flex h-9 items-center rounded-full bg-[rgb(var(--brand-primary))] px-4 text-[13px] font-semibold text-[rgb(var(--brand-primary-on))] shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending ? "Saving…" : "Save"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onContinue}
                  disabled={!canContinue}
                  className="inline-flex h-9 items-center rounded-full bg-[rgb(var(--text-strong))] px-4 text-[13px] font-semibold text-[rgb(var(--surface-card))] shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Continue →
                </button>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
