// editor-shell.tsx
//
// Modal chrome for the producer Store wizard (Phase 2). Wraps the active
// step body with a sticky header (close X on LEFT, then step label +
// title + subtitle + StepBar stacked beside it) and footer (Back ·
// Continue/Save). Uses Radix Dialog for portal/scrim/focus so the shell
// stays a pure layout shell.
//
// Mirrors the Phase 1 store-screen modal sizing/positioning but adds the
// design-brief popIn entrance (scale 0.97 → 1, translateY(8) → 0,
// 240ms cubic-bezier(.16,1,.3,1)). The keyframe is inlined via a single
// <style> element because the codebase has no `<style jsx global>`
// pattern; the existing `skitza-pop-in` keyframe in globals.css uses
// scale(0.96) without translateY so it doesn't match the brief.
//
// Animation note: the keyframe runs on an INNER wrapper div, not on
// Dialog.Content. That keeps the inner div's transform isolated from
// Dialog.Content's centering transform (-translate-x-1/2 -translate-y-1/2),
// so the modal stays centered while animating. A previous version put
// the keyframe on Dialog.Content and duplicated it inside a @media
// (max-width: 639px) block, which globally shadowed the centered
// keyframe and made the modal snap from the top-left.
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
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 max-h-[calc(100vh-3rem)] w-[calc(100vw-3rem)] max-w-[520px] rounded-[18px] bg-[rgb(var(--bg-background))] shadow-2xl
            max-sm:left-0 max-sm:right-0 max-sm:top-auto max-sm:bottom-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:max-h-[90vh] max-sm:w-full max-sm:rounded-t-[var(--radius-xl)] max-sm:rounded-b-none max-sm:max-w-none"
        >
          {/* Inline keyframe — see file-level comment for rationale. The
              animation runs on this inner div so its transform stays
              isolated from Dialog.Content's centering transform. */}
          <div
            className="flex max-h-[inherit] flex-col overflow-hidden"
            style={{ animation: "popIn 240ms cubic-bezier(.16,1,.3,1)" }}
          >
            <style>{`@keyframes popIn {
              from { opacity: 0; transform: scale(0.97) translateY(8px); }
              to   { opacity: 1; transform: scale(1) translateY(0); }
            }`}</style>

            {/* Header — X on LEFT, title block to its right (vertically centered with X). */}
            <div className="border-b border-[rgb(var(--border-subtle))] px-6 pb-[18px] pt-[20px]">
              <div className="flex items-center gap-3">
                <DialogPrimitive.Close
                  aria-label="Close"
                  className="sk-press inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))]"
                >
                  <X className="h-4 w-4" aria-hidden />
                </DialogPrimitive.Close>
                <div className="min-w-0 flex-1">
                  <span
                    className="block font-[var(--font-outfit)] text-[10.5px] font-bold uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]"
                  >
                    {stepLabel}
                  </span>
                  <DialogPrimitive.Title
                    className="mt-1 font-[var(--font-syne)] font-extrabold leading-none tracking-[-0.025em] text-[rgb(var(--fg-default))]"
                    style={{ fontSize: "clamp(22px, 4vw, 28px)" }}
                  >
                    {title}
                  </DialogPrimitive.Title>
                  {subtitle ? (
                    <DialogPrimitive.Description className="mt-1.5 truncate text-[13px] leading-snug text-[rgb(var(--fg-muted))]">
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
                    className="sk-press inline-flex h-9 items-center rounded-full px-3 text-[13px] font-medium text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))]"
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
                    className="sk-press inline-flex h-9 items-center rounded-full bg-[rgb(var(--brand-primary))] px-4 text-[13px] font-semibold text-[rgb(var(--bg-sidebar))] shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pending ? "Saving…" : mode === "new" ? "Create product" : "Save changes"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onContinue}
                    disabled={!canContinue}
                    className="sk-press inline-flex h-9 items-center rounded-full bg-[rgb(var(--fg-default))] px-4 text-[13px] font-semibold text-[rgb(var(--bg-elevated))] shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Continue →
                  </button>
                )}
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
