"use client";

import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "~/components/ui/sheet";

const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

interface ClientActionsMenuProps {
  name: string;
  archived: boolean;
  onEdit?: (() => void) | undefined;
  onArchive?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  appearance?: "surface" | "hero";
  label?: string;
  showLabel?: boolean;
  onActionStart?: ((trigger: HTMLButtonElement) => void) | undefined;
}

/**
 * A small disclosure for secondary client actions. It intentionally
 * uses normal buttons instead of claiming the ARIA menu pattern: Tab
 * follows the browser's familiar order, Escape closes and restores
 * focus, and the first action receives focus when opened.
 */
export function ClientActionsMenu({
  name,
  archived,
  onEdit,
  onArchive,
  onDelete,
  appearance = "surface",
  label,
  showLabel = false,
  onActionStart,
}: ClientActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const disclosureId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const actionChosenFromSheetRef = useRef(false);

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const update = () => {
      setIsDesktop(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);

  const closeWithFocusReturn = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }, []);

  // The portaled mobile Sheet owns backdrop dismissal, focus trapping,
  // Escape and focus return. These listeners only serve the anchored
  // desktop disclosure.
  useEffect(() => {
    if (!open || !isDesktop) return;
    firstActionRef.current?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleFocusIn(event: FocusEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeWithFocusReturn();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeWithFocusReturn, isDesktop, open]);

  if (!onEdit && !onArchive && !onDelete) return null;

  const choose = (action: (() => void) | undefined) => {
    actionChosenFromSheetRef.current = !isDesktop;
    setOpen(false);
    // The disclosed item unmounts as its controlled dialog opens. Put
    // focus on the stable trigger first so Radix can return there when
    // the producer closes Edit, Archive, Restore, or Delete.
    if (triggerRef.current) {
      onActionStart?.(triggerRef.current);
      triggerRef.current.focus();
    }
    action?.();
  };
  const hero = appearance === "hero";

  const actionButtons = () => (
    <>
      {onEdit ? (
        <button
          ref={firstActionRef}
          type="button"
          onClick={() => {
            choose(onEdit);
          }}
          className="flex min-h-11 w-full items-center gap-2 px-3 text-left font-medium text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))] focus-visible:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
        >
          <Pencil size={14} strokeWidth={2.2} aria-hidden />
          Edit details
        </button>
      ) : null}
      {onArchive ? (
        <button
          ref={onEdit ? undefined : firstActionRef}
          type="button"
          onClick={() => {
            choose(onArchive);
          }}
          className="flex min-h-11 w-full items-center gap-2 px-3 text-left font-medium text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))] focus-visible:bg-[rgb(var(--bg-overlay))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
        >
          {archived ? (
            <ArchiveRestore size={14} strokeWidth={2.2} aria-hidden />
          ) : (
            <Archive size={14} strokeWidth={2.2} aria-hidden />
          )}
          {archived ? "Restore client" : "Archive client"}
        </button>
      ) : null}
      {onDelete ? (
        <button
          ref={!onEdit && !onArchive ? firstActionRef : undefined}
          type="button"
          onClick={() => {
            choose(onDelete);
          }}
          className="flex min-h-11 w-full items-center gap-2 border-t border-[rgb(var(--border-subtle))] px-3 text-left font-medium text-[rgb(var(--fg-danger-text))] hover:bg-[rgb(var(--fg-danger)/0.08)] focus-visible:bg-[rgb(var(--fg-danger)/0.08)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset"
        >
          <Trash2 size={14} strokeWidth={2.2} aria-hidden />
          Delete empty draft
        </button>
      ) : null}
    </>
  );

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        aria-controls={disclosureId}
        aria-haspopup="dialog"
        aria-label={label ?? `Actions for ${name}`}
        className={[
          "inline-flex min-h-11 min-w-11 items-center justify-center border transition-colors focus-visible:ring-2 focus-visible:outline-none",
          showLabel ? "gap-1.5 rounded-[var(--radius-lg)] px-3" : "rounded-full",
          hero
            ? "border-white/20 bg-white/10 text-white hover:bg-white/20 focus-visible:ring-white/70 lg:min-h-9 lg:min-w-9"
            : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-[rgb(var(--focus-ring))]",
        ].join(" ")}
      >
        <MoreHorizontal size={17} strokeWidth={2.2} aria-hidden />
        {showLabel ? <span className="text-[13px] font-semibold">Manage</span> : null}
      </button>

      {open && isDesktop ? (
        <div
          id={disclosureId}
          role="dialog"
          aria-modal="false"
          aria-label={`Actions for ${name}`}
          data-testid="client-actions-popover"
          className="absolute top-[calc(100%+6px)] right-0 z-40 min-w-[210px] overflow-hidden rounded-[var(--radius-md)] border bg-[rgb(var(--bg-background))] py-1 text-[13px] shadow-[0_18px_40px_-12px_rgba(17,16,9,0.32)]"
          style={{ borderColor: "rgb(var(--border-subtle))" }}
        >
          {actionButtons()}
        </div>
      ) : null}

      <Sheet
        open={open && !isDesktop}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setOpen(false);
        }}
      >
        <SheetContent
          side="bottom"
          id={disclosureId}
          data-testid="client-actions-sheet"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (actionChosenFromSheetRef.current) {
              actionChosenFromSheetRef.current = false;
              return;
            }
            triggerRef.current?.focus();
          }}
          className="max-h-[88dvh] w-full gap-0 overflow-y-auto p-0 pb-[env(safe-area-inset-bottom)] sm:p-0"
        >
          <SheetTitle className="sr-only">Actions for {name}</SheetTitle>
          <SheetDescription className="sr-only">
            Choose an available action for this client.
          </SheetDescription>
          <div role="group" aria-label={`Actions for ${name}`} className="w-full py-2 text-sm">
            {actionButtons()}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
