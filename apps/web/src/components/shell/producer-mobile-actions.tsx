"use client";

import { UserAvatar, UserButton } from "@clerk/nextjs";
import { Copy, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { copyPublicLink } from "~/components/dashboard/overview/public-link-strip";
import { Icon } from "~/components/nav/icons";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import {
  announceRuntimeMainNavigationIntent,
  captureRuntimeMainNavigationTarget,
} from "~/lib/runtime-state/navigation-cache";
import { buildJoinUrl } from "~/lib/share/public-url";

import {
  ACCOUNT_SHEET_UPWARD_OVERSCAN_PX,
  accountSheetDragOffset,
  accountSheetReleaseVelocity,
  shouldDismissAccountSheet,
} from "./account-sheet-drag";

interface ProducerMobileActionsProps {
  producerSlug: string | null;
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

export function ProducerMobileActions({
  producerSlug,
}: ProducerMobileActionsProps) {
  const { toast } = useToast();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const currentHref = `${pathname}${search ? `?${search}` : ""}`;
  const navigationParams = new URLSearchParams(search);
  navigationParams.delete("storeTip");
  const navigationSearch = navigationParams.toString();
  const navigationHref = `${pathname}${navigationSearch ? `?${navigationSearch}` : ""}`;
  const tToasts = useTranslations("today.toasts");
  const [accountOpen, setAccountOpen] = useState(false);
  const [showStoreTip, setShowStoreTip] = useState(false);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const accountSheetRef = useRef<HTMLDivElement>(null);
  const accountSheetDragRef = useRef<AccountSheetDragState | null>(null);
  const accountSheetSettleTimerRef = useRef<number | null>(null);
  const storeTipConsumedRef = useRef(false);
  const storeTipNavigationHrefRef = useRef(navigationHref);
  const accountSheetId = useId();

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

  useEffect(() => {
    if (storeTipConsumedRef.current || searchParams.get("storeTip") !== "1") {
      return;
    }

    storeTipConsumedRef.current = true;
    setShowStoreTip(true);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("storeTip");
    const nextSearch = nextParams.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`,
    );
  }, [pathname, searchParams]);

  useEffect(() => {
    if (storeTipNavigationHrefRef.current === navigationHref) return;
    storeTipNavigationHrefRef.current = navigationHref;
    setShowStoreTip(false);
  }, [navigationHref]);

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

  const handleAccountSheetPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
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
    },
    [],
  );

  const handleAccountSheetPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
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
    },
    [],
  );

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

  async function copyLink() {
    if (!producerSlug) return;
    const clipboard = (navigator as { clipboard?: Clipboard }).clipboard;
    const writeText = clipboard ? clipboard.writeText.bind(clipboard) : undefined;
    const copied = await copyPublicLink(buildJoinUrl(producerSlug), writeText);
    toast(
      copied ? tToasts("copied") : tToasts("couldNotCopy"),
      copied ? "success" : "error",
    );
  }

  return (
    <div
      data-testid="producer-mobile-actions"
      className="flex flex-shrink-0 items-center gap-0.5 lg:hidden"
    >
      {producerSlug ? (
        <button
          type="button"
          onClick={() => {
            void copyLink();
          }}
          aria-label="Copy public link"
          title="Copy public link"
          className="sk-press inline-flex h-10 w-10 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-[transform,background-color,color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          <Copy aria-hidden size={18} strokeWidth={2} />
        </button>
      ) : null}

      <UserButton __experimental_asProvider>
        <div
          data-testid="topbar-account"
          className="relative flex h-10 w-10 items-center justify-center"
        >
          <button
            ref={accountButtonRef}
            type="button"
            aria-label="Open account menu"
            aria-haspopup="dialog"
            aria-expanded={accountOpen}
            aria-controls={accountOpen ? accountSheetId : undefined}
            onClick={() => {
              setShowStoreTip(false);
              setAccountOpen(true);
            }}
            className="sk-press inline-flex h-10 w-10 items-center justify-center rounded-full transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none active:scale-[0.94] motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <UserAvatar
              appearance={{
                elements: {
                  avatarBox: "h-8 w-8 ring-1 ring-[rgb(var(--border-subtle))]",
                },
              }}
            />
          </button>

          {showStoreTip && !accountOpen ? (
            <div
              role="status"
              data-testid="producer-store-tip"
              className="absolute top-[calc(100%+0.625rem)] right-0 z-50 flex w-64 max-w-[calc(100vw-2rem)] items-start gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3 text-left shadow-[var(--shadow-lg)]"
            >
              <span
                aria-hidden
                className="absolute -top-1.5 right-3 h-3 w-3 rotate-45 border-t border-l border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
              />
              <p className="min-w-0 flex-1 text-[13px] leading-snug font-semibold text-[rgb(var(--fg-default))]">
                Manage your Store from your profile photo.
              </p>
              <button
                type="button"
                aria-label="Dismiss Store tip"
                onClick={() => {
                  setShowStoreTip(false);
                }}
                className="sk-press -m-2.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
              >
                <X aria-hidden size={15} strokeWidth={2.2} />
              </button>
            </div>
          ) : null}

          <Sheet
            open={accountOpen}
            onOpenChange={(nextOpen) => {
              if (nextOpen) {
                setShowStoreTip(false);
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
              data-testid="account-sheet"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                accountButtonRef.current?.focus();
              }}
              className="sk-account-sheet-motion max-h-[88dvh] w-full gap-0 overflow-visible p-0 pb-[env(safe-area-inset-bottom)] sm:p-0"
            >
              <div
                aria-hidden
                data-testid="account-sheet-bottom-backing"
                className="pointer-events-none absolute inset-x-0 top-full bg-[rgb(var(--bg-elevated))]"
                style={{ height: ACCOUNT_SHEET_BOTTOM_BACKING_PX }}
              />
              <div
                aria-hidden
                data-testid="account-sheet-handle"
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
                Open your store or settings, manage your account, or sign out.
              </SheetDescription>
              <nav
                aria-label="Producer account links"
                data-testid="producer-mobile-profile-links"
                className="grid grid-cols-1 gap-2 border-b border-[rgb(var(--border-subtle))] p-4"
              >
                <Link
                  href="/dashboard/store"
                  data-sk-nav-destination="/dashboard/store"
                  prefetch={false}
                  onNavigate={() => {
                    announceRuntimeMainNavigationIntent("/dashboard/store");
                    if (currentHref === "/dashboard/store") requestAccountSheetClose();
                  }}
                  onClick={(event) => {
                    captureRuntimeMainNavigationTarget(event.currentTarget);
                  }}
                  className="sk-press flex min-h-16 items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
                >
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-dark))]">
                    <Icon name="store" size={18} />
                  </span>
                  <span className="min-w-0 text-left">
                    <span className="block text-sm font-semibold">Store</span>
                    <span className="mt-0.5 block text-xs font-normal text-[rgb(var(--fg-muted))]">
                      Products and private offers
                    </span>
                  </span>
                </Link>
                <Link
                  href="/dashboard/settings"
                  data-sk-nav-destination="/dashboard/settings"
                  prefetch={false}
                  onNavigate={() => {
                    announceRuntimeMainNavigationIntent("/dashboard/settings");
                    if (currentHref === "/dashboard/settings") requestAccountSheetClose();
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
                      userButtonPopoverCard:
                        "w-full max-w-none border-0 bg-transparent shadow-none",
                    },
                  }}
                />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </UserButton>
    </div>
  );
}
