// editor-shell.tsx
//
// Presentation chrome for the producer Store wizard (Phase 2). Wraps the active
// step body with a sticky header (close X on LEFT, then step label +
// title + subtitle + StepBar stacked beside it) and footer (Back ·
// Continue/Save). Store uses Radix Dialog for portal/scrim/focus; onboarding
// uses the same frame inline so its own progress and navigation remain visible.
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
import { useLayoutEffect, useRef, type ReactElement, type ReactNode, type RefObject } from "react";

import { SaveIndicator, type SaveStatus } from "~/components/ui/save-indicator";

import { StepBar } from "./step-bar";

export interface EditorShellAction {
  label: string;
  pendingLabel?: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "quiet";
  ariaLabel?: string;
}

interface EditorShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactElement | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
  presentation?: "dialog" | "embedded";
  mode: "new" | "edit";
  productName?: string;
  productActive?: boolean;
  steps: readonly string[];
  current: string;
  title: string;
  subtitle?: string;
  canContinue: boolean;
  onBack: () => void;
  onContinue: () => void;
  onSave: () => void;
  onPublish: () => void;
  onSaveHidden: () => void;
  onDiscard: () => void;
  isLastStep: boolean;
  isFirstStep: boolean;
  children: ReactNode;
  pending?: boolean;
  pendingAction?: "publish" | "hidden" | "edit";
  saveStatus?: SaveStatus;
  newProductFlow?: "store" | "onboarding";
  editorLabel?: string;
  stepLabel?: string;
  progressLabel?: string;
  progressContent?: ReactNode;
  closeLabel?: string;
  backLabel?: string;
  continueLabel?: string;
  finalNote?: ReactNode | null;
  showDiscard?: boolean;
  discardLabel?: string;
  utilityAction?: EditorShellAction;
  finalActions?: readonly EditorShellAction[];
}

export function EditorShell({
  open,
  onOpenChange,
  trigger,
  returnFocusRef,
  presentation = "dialog",
  mode,
  productName,
  productActive = false,
  steps,
  current,
  title,
  subtitle,
  canContinue,
  onBack,
  onContinue,
  onSave,
  onPublish,
  onSaveHidden,
  onDiscard,
  isLastStep,
  isFirstStep,
  children,
  pending = false,
  pendingAction,
  saveStatus = "idle",
  newProductFlow = "store",
  editorLabel: editorLabelOverride,
  stepLabel: stepLabelOverride,
  progressLabel = "Product setup progress",
  progressContent,
  closeLabel = "Close",
  backLabel = "← Back",
  continueLabel = "Continue →",
  finalNote: finalNoteOverride,
  showDiscard = true,
  discardLabel = "Discard draft",
  utilityAction,
  finalActions,
}: EditorShellProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef<string | null>(null);
  const embedded = presentation === "embedded";
  const currentIdx = Math.max(0, steps.indexOf(current));
  const currentNum = String(currentIdx + 1);
  const totalNum = String(steps.length);
  const defaultStepLabel =
    mode === "new"
      ? `Step ${currentNum} of ${totalNum} · NEW PRODUCT`
      : `Step ${currentNum} of ${totalNum} · EDITING · ${productName ?? "product"}`;
  const stepLabel = stepLabelOverride ?? defaultStepLabel;
  const saveLabel = productActive ? "Save live changes" : "Save hidden changes";

  useLayoutEffect(() => {
    const previousStep = previousStepRef.current;
    previousStepRef.current = current;

    if (presentation === "embedded") {
      if (previousStep !== null && previousStep !== current) {
        frameRef.current?.scrollIntoView({ block: "start" });
      }
    } else if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }

    if (previousStep === null || previousStep === current || !open) return;
    const frame = window.requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [current, open, presentation]);

  const editorLabel =
    editorLabelOverride ?? (mode === "new" ? "New product" : `Edit ${productName ?? "product"}`);
  const defaultFinalNote =
    mode === "new"
      ? newProductFlow === "onboarding"
        ? "This stays hidden until you publish your page at the end of setup."
        : "Publishing makes this visible to connected artists immediately."
      : productActive
        ? "Artists will see this update immediately."
        : "This product stays hidden after you save.";
  const finalNote = finalNoteOverride === undefined ? defaultFinalNote : finalNoteOverride;
  const closeClassName = `sk-press absolute right-3 inline-flex h-11 w-11 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:cursor-not-allowed disabled:opacity-50 sm:top-4 sm:right-4 sm:h-10 sm:w-10 ${
    embedded ? "top-3" : "top-[calc(12px+env(safe-area-inset-top,0px))]"
  }`;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && pending) return;
    onOpenChange(nextOpen);
  }

  if (!open && embedded) return null;

  const shell = (
    <div
      ref={frameRef}
      className={`sk-editor-shell-motion flex min-h-0 flex-col ${
        embedded ? "" : "max-h-[inherit] overflow-hidden max-sm:h-full"
      }`}
      style={embedded ? undefined : { animation: "popIn 240ms cubic-bezier(.16,1,.3,1)" }}
    >
      <style>{`@keyframes popIn {
        from { opacity: 0; transform: scale(0.97) translateY(8px); }
        to   { opacity: 1; transform: scale(1) translateY(0); }
      }
      @media (prefers-reduced-motion: reduce) {
        .sk-editor-shell-motion { animation: none !important; }
      }`}</style>

      <div
        className={`relative shrink-0 border-b border-[rgb(var(--border-subtle))] px-5 pb-3.5 sm:px-6 sm:pt-[20px] sm:pb-[18px] ${
          embedded ? "pt-4" : "pt-[calc(16px+env(safe-area-inset-top,0px))]"
        }`}
      >
        {embedded ? (
          <button
            type="button"
            aria-label={closeLabel}
            disabled={pending}
            onClick={() => {
              handleOpenChange(false);
            }}
            className={closeClassName}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : (
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className={closeClassName}
            disabled={pending}
          >
            <X className="h-4 w-4" aria-hidden />
          </DialogPrimitive.Close>
        )}
        <div className="min-w-0 pr-12 sm:pr-14">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="block text-[10.5px] font-[var(--font-outfit)] font-bold tracking-[0.16em] break-words whitespace-normal text-[rgb(var(--fg-muted))] uppercase">
              {stepLabel}
            </span>
            <SaveIndicator status={saveStatus} />
          </div>
          {embedded ? (
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="mt-1 leading-none font-[var(--font-syne)] font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))] outline-none"
              style={{ fontSize: "clamp(22px, 4vw, 28px)" }}
            >
              {title}
            </h2>
          ) : (
            <DialogPrimitive.Title
              ref={headingRef}
              tabIndex={-1}
              className="mt-1 leading-none font-[var(--font-syne)] font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))] outline-none"
              style={{ fontSize: "clamp(22px, 4vw, 28px)" }}
            >
              {title}
            </DialogPrimitive.Title>
          )}
          {subtitle ? (
            embedded ? (
              <p className="mt-1.5 text-[13px] leading-snug text-pretty whitespace-normal text-[rgb(var(--fg-muted))]">
                {subtitle}
              </p>
            ) : (
              <DialogPrimitive.Description className="mt-1.5 text-[13px] leading-snug text-pretty whitespace-normal text-[rgb(var(--fg-muted))]">
                {subtitle}
              </DialogPrimitive.Description>
            )
          ) : embedded ? null : (
            <DialogPrimitive.Description className="sr-only">
              {editorLabel}
            </DialogPrimitive.Description>
          )}
        </div>
        {progressContent === undefined ? (
          <div className="mt-4">
            <StepBar steps={steps} current={current} ariaLabel={progressLabel} />
          </div>
        ) : progressContent ? (
          <div className="mt-4">{progressContent}</div>
        ) : null}
      </div>

      <div
        ref={bodyRef}
        aria-busy={pending}
        inert={pending}
        className={`min-h-0 min-w-0 px-5 py-4 sm:px-6 sm:py-5 ${
          embedded ? "" : "flex-1 overflow-y-auto overscroll-contain"
        }`}
      >
        {children}
      </div>

      <div className="shrink-0 border-t border-[rgb(var(--border-subtle))] px-5 py-3 max-sm:pb-[calc(12px+env(safe-area-inset-bottom,0px))] sm:px-6 sm:py-4">
        {isLastStep && finalNote ? (
          <p className="mb-2 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">{finalNote}</p>
        ) : null}
        <div className="flex items-center justify-between gap-2 max-sm:flex-wrap">
          <div className="flex items-center gap-1">
            {isFirstStep ? null : (
              <button
                type="button"
                onClick={onBack}
                disabled={pending}
                className="sk-press inline-flex h-11 items-center rounded-[var(--radius-lg)] px-3 text-[13px] font-medium text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:rounded-[var(--radius-md)]"
              >
                {backLabel}
              </button>
            )}
            {showDiscard ? (
              <button
                type="button"
                onClick={onDiscard}
                disabled={pending}
                className="sk-press inline-flex h-11 items-center rounded-[var(--radius-lg)] px-3 text-[12.5px] font-medium text-[rgb(var(--fg-faint))] transition-colors hover:bg-[rgb(var(--fg-danger)/0.08)] hover:text-[rgb(var(--fg-danger))] disabled:opacity-50 sm:h-10 sm:rounded-[var(--radius-md)]"
              >
                {discardLabel}
              </button>
            ) : null}
            {utilityAction ? (
              <button
                type="button"
                aria-label={utilityAction.ariaLabel}
                onClick={utilityAction.onClick}
                disabled={pending || utilityAction.disabled}
                className="sk-press inline-flex h-11 items-center rounded-[var(--radius-lg)] px-3 text-[12.5px] font-semibold text-[rgb(var(--brand-primary-dark))] transition-colors hover:bg-[rgb(var(--brand-primary)/0.08)] disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:rounded-[var(--radius-md)]"
              >
                {pending && utilityAction.pendingLabel
                  ? utilityAction.pendingLabel
                  : utilityAction.label}
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2 max-sm:w-full max-sm:justify-end">
            {isLastStep && finalActions ? (
              finalActions.map((action) => {
                const variant = action.variant ?? "primary";
                const classes =
                  variant === "primary"
                    ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))] shadow-sm hover:opacity-90"
                    : variant === "secondary"
                      ? "border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))] hover:border-[rgb(var(--border-strong))]"
                      : "text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)]";
                return (
                  <button
                    key={action.label}
                    type="button"
                    aria-label={action.ariaLabel}
                    onClick={action.onClick}
                    disabled={pending || action.disabled}
                    className={`sk-press inline-flex h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold transition-[border-color,opacity] disabled:cursor-not-allowed disabled:opacity-50 max-sm:flex-1 sm:h-10 sm:rounded-[var(--radius-md)] ${classes}`}
                  >
                    {pending && action.pendingLabel ? action.pendingLabel : action.label}
                  </button>
                );
              })
            ) : isLastStep && mode === "new" && newProductFlow === "onboarding" ? (
              <button
                type="button"
                onClick={onSaveHidden}
                disabled={!canContinue || pending}
                className="sk-press inline-flex h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 text-[13px] font-semibold text-[rgb(var(--bg-sidebar))] shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 max-sm:flex-1 sm:h-10 sm:rounded-[var(--radius-md)]"
              >
                {pending && pendingAction === "hidden" ? "Saving…" : "Continue setup"}
              </button>
            ) : isLastStep && mode === "new" ? (
              <>
                <button
                  type="button"
                  onClick={onSaveHidden}
                  disabled={!canContinue || pending}
                  className="sk-press inline-flex h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 text-[13px] font-semibold text-[rgb(var(--fg-default))] transition-colors hover:border-[rgb(var(--border-strong))] disabled:cursor-not-allowed disabled:opacity-50 max-sm:flex-1 sm:h-10 sm:rounded-[var(--radius-md)]"
                >
                  {pending && pendingAction === "hidden" ? "Saving…" : "Save hidden"}
                </button>
                <button
                  type="button"
                  onClick={onPublish}
                  disabled={!canContinue || pending}
                  className="sk-press inline-flex h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-[13px] font-semibold text-[rgb(var(--bg-sidebar))] shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 max-sm:flex-1 sm:h-10 sm:rounded-[var(--radius-md)]"
                >
                  {pending && pendingAction === "publish" ? "Publishing…" : "Publish product"}
                </button>
              </>
            ) : isLastStep ? (
              <button
                type="button"
                onClick={onSave}
                disabled={!canContinue || pending}
                className="sk-press inline-flex h-11 items-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-[13px] font-semibold text-[rgb(var(--bg-sidebar))] shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:rounded-[var(--radius-md)]"
              >
                {pending && pendingAction === "edit" ? "Saving…" : saveLabel}
              </button>
            ) : (
              <button
                type="button"
                onClick={onContinue}
                disabled={!canContinue}
                className="sk-press inline-flex h-11 items-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[13px] font-semibold text-[rgb(var(--bg-elevated))] shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:rounded-[var(--radius-md)]"
              >
                {continueLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return (
      <section
        aria-label={editorLabel}
        className="overflow-hidden rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] shadow-[0_22px_64px_rgb(var(--bg-sidebar)/0.08)]"
      >
        {shell}
      </section>
    );
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-label={editorLabel}
          onCloseAutoFocus={(event) => {
            const target = returnFocusRef?.current;
            if (!target?.isConnected) return;
            event.preventDefault();
            target.focus();
          }}
          className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-xl)] bg-[rgb(var(--bg-background))] shadow-2xl max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none"
        >
          {shell}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
