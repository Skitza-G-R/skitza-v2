"use client";

import { UserAvatar, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "~/components/ui/sheet";
import {
  announceRuntimeMainNavigationIntent,
  captureRuntimeMainNavigationTarget,
} from "~/lib/runtime-state/navigation-cache";
import type { ProducerProfileStatus } from "~/server/auth/role";

import {
  ACCOUNT_SHEET_UPWARD_OVERSCAN_PX,
  accountSheetDragOffset,
  accountSheetReleaseVelocity,
  shouldDismissAccountSheet,
} from "../shell/account-sheet-drag";
import { renderAccountRoleMenuItems, useAccountRoleMenuModel } from "./account-role-menu-items";
import { Icon } from "./icons";

interface ArtistUserButtonProps {
  userId: string;
  producerStatus: ProducerProfileStatus;
  producerUnreadCount: number;
  paymentsHref: string;
  settingsHref: string;
  ringClassName: string;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const ACCOUNT_SHEET_SETTLE_MS = 240;
const ACCOUNT_SHEET_BORDER_WIDTH_PX = 1;
const ACCOUNT_SHEET_BOTTOM_BACKING_PX =
  ACCOUNT_SHEET_UPWARD_OVERSCAN_PX + ACCOUNT_SHEET_BORDER_WIDTH_PX;

type AccountSheetDragState = {
  pointerId: number;
  startY: number;
  lastY: number;
  lastTime: number;
  velocityPxPerMs: number;
};

export function ArtistUserButton({
  userId,
  producerStatus,
  producerUnreadCount,
  paymentsHref,
  settingsHref,
  ringClassName,
}: ArtistUserButtonProps) {
  const menuModel = useAccountRoleMenuModel({
    currentRole: "artist",
    userId,
    producerStatus,
    hasArtistAccount: true,
    otherRoleUnreadCount: producerUnreadCount,
    paymentsHref,
    settingsHref,
  });

  return (
    <UserButton
      appearance={{
        elements: {
          avatarBox: `h-11 w-11 ring-1 ${ringClassName}`,
        },
      }}
    >
      {renderAccountRoleMenuItems(menuModel)}
    </UserButton>
  );
}

export function ArtistMobileUserButton({
  userId,
  producerStatus,
  producerUnreadCount,
  paymentsHref,
  settingsHref,
  ringClassName,
}: ArtistUserButtonProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const currentHref = `${pathname}${search ? `?${search}` : ""}`;
  const [accountOpen, setAccountOpen] = useState(false);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const accountSheetRef = useRef<HTMLDivElement>(null);
  const accountSheetDragRef = useRef<AccountSheetDragState | null>(null);
  const accountSheetSettleTimerRef = useRef<number | null>(null);
  const accountSheetId = useId();
  const menuModel = useAccountRoleMenuModel({
    currentRole: "artist",
    userId,
    producerStatus,
    hasArtistAccount: true,
    otherRoleUnreadCount: producerUnreadCount,
    paymentsHref,
    settingsHref,
  });

  const requestAccountSheetClose = useCallback(() => {
    const sheet = accountSheetRef.current;
    if (accountSheetSettleTimerRef.current !== null) {
      window.clearTimeout(accountSheetSettleTimerRef.current);
      accountSheetSettleTimerRef.current = null;
    }
    accountSheetDragRef.current = null;
    sheet?.style.removeProperty("animation");
    sheet?.style.removeProperty("transition");
    sheet?.style.removeProperty("transform");
    sheet?.style.removeProperty("will-change");
    sheet?.style.removeProperty("pointer-events");
    setAccountOpen(false);
  }, []);

  useEffect(() => {
    requestAccountSheetClose();
  }, [currentHref, requestAccountSheetClose]);

  useEffect(
    () => () => {
      if (accountSheetSettleTimerRef.current !== null) {
        window.clearTimeout(accountSheetSettleTimerRef.current);
      }
    },
    [],
  );

  const settleAccountSheetDrag = useCallback((dismiss: boolean) => {
    const sheet = accountSheetRef.current;
    if (!sheet) return;

    if (accountSheetSettleTimerRef.current !== null) {
      window.clearTimeout(accountSheetSettleTimerRef.current);
    }

    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY).matches;
    if (reducedMotion) {
      sheet.style.transform = "translate3d(0, 0, 0)";
      sheet.style.removeProperty("transition");
      sheet.style.removeProperty("will-change");
      if (dismiss) setAccountOpen(false);
      return;
    }

    sheet.style.transition = `transform ${String(ACCOUNT_SHEET_SETTLE_MS)}ms cubic-bezier(0.32, 0.72, 0, 1)`;
    sheet.style.transform = dismiss ? "translate3d(0, 100%, 0)" : "translate3d(0, 0, 0)";
    if (dismiss) sheet.style.pointerEvents = "none";

    accountSheetSettleTimerRef.current = window.setTimeout(() => {
      accountSheetSettleTimerRef.current = null;
      if (dismiss) {
        setAccountOpen(false);
        return;
      }
      sheet.style.removeProperty("transition");
      sheet.style.removeProperty("transform");
      sheet.style.removeProperty("will-change");
    }, ACCOUNT_SHEET_SETTLE_MS);
  }, []);

  const handleAccountSheetPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    const sheet = accountSheetRef.current;
    if (!sheet) return;

    if (accountSheetSettleTimerRef.current !== null) {
      window.clearTimeout(accountSheetSettleTimerRef.current);
      accountSheetSettleTimerRef.current = null;
    }
    accountSheetDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocityPxPerMs: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    sheet.style.animation = "none";
    sheet.style.transition = "none";
    sheet.style.willChange = "transform";
  }, []);

  const handleAccountSheetPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = accountSheetDragRef.current;
    const sheet = accountSheetRef.current;
    if (!drag || !sheet || drag.pointerId !== event.pointerId) return;

    const elapsed = Math.max(1, event.timeStamp - drag.lastTime);
    drag.velocityPxPerMs = (event.clientY - drag.lastY) / elapsed;
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;

    const distance = accountSheetDragOffset(event.clientY - drag.startY);
    sheet.style.transform = `translate3d(0, ${String(distance)}px, 0)`;
    event.preventDefault();
  }, []);

  const finishAccountSheetDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, canceled: boolean) => {
      const drag = accountSheetDragRef.current;
      const sheet = accountSheetRef.current;
      if (!drag || !sheet || drag.pointerId !== event.pointerId) return;

      accountSheetDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const distance = event.clientY - drag.startY;
      const releaseVelocity = accountSheetReleaseVelocity({
        previousVelocityPxPerMs: drag.velocityPxPerMs,
        lastY: drag.lastY,
        lastTime: drag.lastTime,
        releaseY: event.clientY,
        releaseTime: event.timeStamp,
      });
      settleAccountSheetDrag(
        !canceled &&
          shouldDismissAccountSheet({
            distancePx: distance,
            velocityPxPerMs: releaseVelocity,
            sheetHeightPx: sheet.getBoundingClientRect().height,
          }),
      );
    },
    [settleAccountSheetDrag],
  );

  const handleAccountSheetPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      finishAccountSheetDrag(event, false);
    },
    [finishAccountSheetDrag],
  );

  const handleAccountSheetPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      finishAccountSheetDrag(event, true);
    },
    [finishAccountSheetDrag],
  );

  const handleAccountSheetLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      const drag = accountSheetDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      finishAccountSheetDrag(event, true);
    },
    [finishAccountSheetDrag],
  );

  return (
    <UserButton __experimental_asProvider>
      {renderAccountRoleMenuItems(menuModel, {
        includePayments: false,
        includeSettings: false,
      })}
      <div className="relative flex h-11 w-11 items-center justify-center">
        <button
          ref={accountButtonRef}
          type="button"
          aria-label="Open account menu"
          aria-haspopup="dialog"
          aria-expanded={accountOpen}
          aria-controls={accountOpen ? accountSheetId : undefined}
          onClick={() => {
            setAccountOpen(true);
          }}
          className="sk-press inline-flex h-11 w-11 items-center justify-center rounded-full transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          <UserAvatar
            appearance={{
              elements: {
                avatarBox: `h-11 w-11 ring-1 ${ringClassName}`,
              },
            }}
          />
        </button>

        <Sheet
          open={accountOpen}
          onOpenChange={(nextOpen) => {
            if (nextOpen) {
              setAccountOpen(true);
              return;
            }
            requestAccountSheetClose();
          }}
        >
          <SheetContent
            ref={accountSheetRef}
            side="bottom"
            showHandle={false}
            overlayClassName="sk-account-sheet-overlay-motion"
            id={accountSheetId}
            data-testid="artist-account-sheet"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              accountButtonRef.current?.focus();
            }}
            className="sk-account-sheet-motion max-h-[88dvh] w-full gap-0 overflow-visible p-0 pb-[env(safe-area-inset-bottom)] sm:p-0"
          >
            <div
              aria-hidden
              data-testid="artist-account-sheet-bottom-backing"
              className="pointer-events-none absolute inset-x-0 top-full bg-[rgb(var(--bg-elevated))]"
              style={{ height: ACCOUNT_SHEET_BOTTOM_BACKING_PX }}
            />
            <div
              aria-hidden
              data-testid="artist-account-sheet-handle"
              onPointerDown={handleAccountSheetPointerDown}
              onPointerMove={handleAccountSheetPointerMove}
              onPointerUp={handleAccountSheetPointerUp}
              onPointerCancel={handleAccountSheetPointerCancel}
              onLostPointerCapture={handleAccountSheetLostPointerCapture}
              className="flex h-8 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
            >
              <span className="h-1 w-11 rounded-full bg-[rgb(var(--border-subtle))]" />
            </div>
            <SheetTitle className="sr-only">Account</SheetTitle>
            <SheetDescription className="sr-only">
              Open your settings, manage your account, switch roles, or sign out.
            </SheetDescription>
            <nav
              aria-label="Artist account links"
              className="grid grid-cols-1 gap-2 border-b border-[rgb(var(--border-subtle))] p-4"
            >
              <Link
                href={paymentsHref}
                data-sk-nav-destination={paymentsHref}
                prefetch={false}
                onNavigate={() => {
                  announceRuntimeMainNavigationIntent(paymentsHref);
                  if (currentHref === paymentsHref) requestAccountSheetClose();
                }}
                onClick={(event) => {
                  captureRuntimeMainNavigationTarget(event.currentTarget);
                }}
                className="sk-press flex min-h-16 items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 text-sm font-semibold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
              >
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--bg-overlay))] text-[rgb(var(--fg-muted))]">
                  <Icon name="payments" size={18} />
                </span>
                Payments
              </Link>
              <Link
                href={settingsHref}
                data-sk-nav-destination={settingsHref}
                prefetch={false}
                onNavigate={() => {
                  announceRuntimeMainNavigationIntent(settingsHref);
                  if (currentHref === settingsHref) requestAccountSheetClose();
                }}
                onClick={(event) => {
                  captureRuntimeMainNavigationTarget(event.currentTarget);
                }}
                className="sk-press flex min-h-16 items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 text-sm font-semibold text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
              >
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--bg-overlay))] text-[rgb(var(--fg-muted))]">
                  <Icon name="settings" size={18} />
                </span>
                Settings
              </Link>
            </nav>
            <div className="min-h-0 w-full flex-1 overflow-y-auto overscroll-contain p-4 pt-2">
              <UserButton.__experimental_Outlet
                defaultOpen
                __experimental_asStandalone={(opened) => {
                  if (!opened) requestAccountSheetClose();
                }}
                appearance={{
                  elements: {
                    rootBox: "w-full",
                    userButtonPopoverCard: "w-full max-w-none border-0 bg-transparent shadow-none",
                  },
                }}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </UserButton>
  );
}
