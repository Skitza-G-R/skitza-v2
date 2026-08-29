"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type CSSProperties,
  createContext,
  type KeyboardEvent,
  type RefObject,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  buildDashboardBreadcrumbs,
  calculateFloatingMenuPosition,
  createPaginationModel,
  type FloatingMenuPlacement,
} from "./dashboard-interaction-model";
import styles from "./dashboard.module.css";

type FeedbackTone = "danger" | "success";

type Feedback = {
  id: number;
  message: string;
  tone: FeedbackTone;
};

type DashboardFeedbackContextValue = {
  showFeedback: (message: string, tone?: FeedbackTone) => void;
};

const DashboardFeedbackContext = createContext<DashboardFeedbackContextValue | null>(null);

export function DashboardInteractionProvider({ children }: { children: ReactNode }) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const showFeedback = useCallback((message: string, tone: FeedbackTone = "success") => {
    setFeedback({
      id: Date.now(),
      message,
      tone,
    });
  }, []);

  useEffect(() => {
    if (!feedback) return;

    const timeout = window.setTimeout(() => {
      setFeedback(null);
    }, 3_500);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [feedback]);

  const value = useMemo(() => ({ showFeedback }), [showFeedback]);

  return (
    <DashboardFeedbackContext.Provider value={value}>
      {children}
      <div className={styles.toastViewport} aria-live="polite" aria-relevant="additions">
        {feedback ? (
          <div className={styles.toast} data-tone={feedback.tone} key={feedback.id} role="status">
            <span className={styles.toastMarker} aria-hidden="true" />
            <span>{feedback.message}</span>
            <button
              aria-label="Dismiss message"
              className={styles.toastDismiss}
              onClick={() => {
                setFeedback(null);
              }}
              type="button"
            >
              ×
            </button>
          </div>
        ) : null}
      </div>
    </DashboardFeedbackContext.Provider>
  );
}

export function useDashboardFeedback(): DashboardFeedbackContextValue {
  const context = useContext(DashboardFeedbackContext);
  if (!context) {
    throw new Error("useDashboardFeedback must be used inside DashboardInteractionProvider.");
  }
  return context;
}

export function useFloatingMenuPosition({
  menuRef,
  open,
  placement,
  triggerRef,
}: {
  menuRef: RefObject<HTMLElement | null>;
  open: boolean;
  placement: FloatingMenuPlacement;
  triggerRef: RefObject<HTMLElement | null>;
}): CSSProperties {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const menu = menuRef.current;
      const trigger = triggerRef.current;
      if (!menu || !trigger) return;

      const menuRect = menu.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      setPosition(
        calculateFloatingMenuPosition({
          menu: { height: menuRect.height, width: menuRect.width },
          placement,
          trigger: {
            bottom: triggerRect.bottom,
            left: triggerRect.left,
            right: triggerRect.right,
            top: triggerRect.top,
          },
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
        }),
      );
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [menuRef, open, placement, triggerRef]);

  return {
    bottom: "auto",
    left: position?.left ?? 0,
    position: "fixed",
    right: "auto",
    top: position?.top ?? 0,
    visibility: position ? "visible" : "hidden",
  };
}

export function Breadcrumbs({ recordLabel }: { recordLabel?: string }) {
  const pathname = usePathname();
  const items = buildDashboardBreadcrumbs(pathname, recordLabel);

  return (
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${String(index)}`}>
            {item.href ? (
              <Link href={item.href}>{item.label}</Link>
            ) : (
              <span aria-current={index === items.length - 1 ? "page" : undefined}>
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export type DashboardAction = {
  disabled?: boolean;
  label: string;
  onSelect: () => void;
  tone?: "danger" | "default";
};

export function ActionMenu({
  actions,
  label = "More actions",
  placement = "down",
}: {
  actions: readonly DashboardAction[];
  label?: string;
  placement?: "down" | "up";
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const popoverStyle = useFloatingMenuPosition({
    menuRef: popoverRef,
    open: isOpen,
    placement,
    triggerRef,
  });

  const closeMenu = () => {
    if (detailsRef.current) detailsRef.current.open = false;
    setIsOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key === "Escape") {
      closeMenu();
      detailsRef.current?.querySelector("summary")?.focus();
    }
  };

  return (
    <details
      className={styles.actionMenu}
      data-placement={placement}
      onKeyDown={handleKeyDown}
      onToggle={(event) => {
        setIsOpen(event.currentTarget.open);
      }}
      ref={detailsRef}
    >
      <summary
        aria-controls={popoverId}
        aria-expanded={isOpen}
        className={styles.actionMenuTrigger}
        ref={triggerRef}
      >
        <span className={styles.visuallyHidden}>{label}</span>
        <span className={styles.actionMenuIcon} aria-hidden="true">
          •••
        </span>
      </summary>
      <div
        aria-label={label}
        className={styles.actionMenuPopover}
        id={popoverId}
        ref={popoverRef}
        role="group"
        style={popoverStyle}
      >
        {actions.map((action) => (
          <button
            className={styles.actionMenuItem}
            data-tone={action.tone ?? "default"}
            disabled={action.disabled}
            key={action.label}
            onClick={() => {
              action.onSelect();
              closeMenu();
            }}
            type="button"
          >
            {action.label}
          </button>
        ))}
      </div>
    </details>
  );
}

export function ConfirmationDialog({
  cancelLabel = "Cancel",
  children,
  confirmDisabled = false,
  confirmLabel,
  description,
  onClose,
  onConfirm,
  open,
  title,
  tone = "default",
}: {
  cancelLabel?: string;
  children?: ReactNode;
  confirmDisabled?: boolean;
  confirmLabel: string;
  description: string;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
  tone?: "danger" | "default";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={styles.confirmationDialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className={styles.dialogMarker} data-tone={tone} aria-hidden="true" />
      <div>
        <p className={styles.dialogEyebrow}>Confirm simulated action</p>
        <h2 className={styles.dialogTitle} id={titleId}>
          {title}
        </h2>
        <p className={styles.dialogDescription} id={descriptionId}>
          {description}
        </p>
        {children}
      </div>
      <div className={styles.dialogActions}>
        <button className={styles.secondaryAction} onClick={onClose} type="button">
          {cancelLabel}
        </button>
        <button
          className={styles.primaryAction}
          data-tone={tone}
          disabled={confirmDisabled}
          onClick={() => {
            if (confirmDisabled) return;
            onConfirm();
            onClose();
          }}
          type="button"
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export function CopyIdControl({
  label = "Copy ID",
  successMessage = "ID copied",
  value,
}: {
  label?: string;
  successMessage?: string;
  value: string;
}) {
  const { showFeedback } = useDashboardFeedback();

  const copyValue = async () => {
    try {
      await navigator.clipboard.writeText(value);
      showFeedback(successMessage);
    } catch {
      showFeedback("Copy failed. Try again.", "danger");
    }
  };

  return (
    <button
      className={styles.copyControl}
      onClick={() => {
        void copyValue();
      }}
      type="button"
    >
      <span className={styles.copyIcon} aria-hidden="true">
        ⧉
      </span>
      {label}
    </button>
  );
}

export function PaginationControl({
  currentPage,
  onPageChange,
  pageSize,
  totalItems,
}: {
  currentPage: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  totalItems: number;
}) {
  const model = createPaginationModel({ currentPage, pageSize, totalItems });

  return (
    <nav className={styles.pagination} aria-label="Pagination">
      <p className={styles.paginationSummary}>
        {model.startItem}–{model.endItem} of {totalItems}
      </p>
      <div className={styles.paginationControls}>
        <button
          aria-label="Previous page"
          className={styles.pageButton}
          disabled={model.currentPage === 1}
          onClick={() => {
            onPageChange(model.currentPage - 1);
          }}
          type="button"
        >
          ←
        </button>
        {model.pages.map((page) => (
          <button
            aria-current={page === model.currentPage ? "page" : undefined}
            aria-label={`Page ${String(page)}`}
            className={styles.pageButton}
            data-active={page === model.currentPage}
            key={page}
            onClick={() => {
              onPageChange(page);
            }}
            type="button"
          >
            {page}
          </button>
        ))}
        <button
          aria-label="Next page"
          className={styles.pageButton}
          disabled={model.currentPage === model.totalPages}
          onClick={() => {
            onPageChange(model.currentPage + 1);
          }}
          type="button"
        >
          →
        </button>
      </div>
    </nav>
  );
}
