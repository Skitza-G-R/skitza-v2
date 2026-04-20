"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_META,
  type Locale,
} from "~/i18n/config";

// Language switcher chip — renders a compact "ENG" / "עב" button in
// the sidebar footer next to ThemeToggle + UserButton. Clicking opens
// a small popover listing every available locale in its native script.
// Selecting a locale writes the NEXT_LOCALE cookie + calls
// `router.refresh()` so the root layout re-resolves the locale and
// swaps the message bundle + `dir` attribute without a full
// navigation. The choice persists across sessions so IP-detection
// doesn't override a user preference on the next visit.
//
// Accessibility: listbox-style popover anchored via a relative
// wrapper. Escape closes. Click-outside closes. The trigger is a
// plain button; we keep the markup simple (no @radix-ui/react-popover
// for a ~6-item menu) and defer to native focus semantics.
//
// Styling matches ThemeToggle's h-9 footprint so the row in the
// sidebar footer stays visually balanced.

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

function setLocaleCookie(next: Locale) {
  // Writing the cookie client-side keeps the switcher a pure Client
  // Component — no server action round-trip. `SameSite=Lax` is the
  // sensible default (cookies cross-origin on top-level navigation
  // only). `path=/` so the cookie applies to every route.
  document.cookie = [
    `${LOCALE_COOKIE}=${next}`,
    "Path=/",
    `Max-Age=${String(COOKIE_MAX_AGE_SECONDS)}`,
    "SameSite=Lax",
  ].join("; ");
}

export function LanguageSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("language");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Click-outside + Escape close — standard popover pattern. We bind
  // to `mousedown` so the close fires before any nested button click
  // can handle its own logic.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (next: Locale) => {
    setLocaleCookie(next);
    setOpen(false);
    // `refresh` re-executes the active route's Server Components,
    // which re-reads the cookie via `getRequestConfig` → new locale +
    // new messages. `<html dir>` flips because the root layout reads
    // `getLocale()` again. No full-page reload needed.
    router.refresh();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("switch")}
        title={t("switch")}
        onClick={() => {
          setOpen((o) => !o);
        }}
        // Compact h-9 matches ThemeToggle + NotificationBell so the
        // sidebar footer row stays visually balanced. px is tighter
        // in the collapsed rail where only the short code shows.
        className={[
          "inline-flex h-9 items-center justify-center rounded-md font-mono text-[0.68rem] uppercase tracking-wider text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]",
          collapsed ? "w-9" : "px-2",
        ].join(" ")}
      >
        {LOCALE_META[locale].short}
      </button>
      {open ? (
        // Anchored popover — mounted in-flow so it inherits the
        // sidebar's stacking context. `bottom-full` lifts it above
        // the trigger (sidebar footer sits at the bottom; opening
        // upward avoids clipping against the viewport edge).
        <ul
          role="listbox"
          aria-label={t("switch")}
          // `start-0` = left-0 under LTR, right-0 under RTL — the
          // popover anchors to the logical start edge of the trigger
          // in both directions.
          className="absolute bottom-full start-0 z-50 mb-2 min-w-[8rem] rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-1 shadow-[var(--shadow-md)]"
        >
          {LOCALES.map((code) => {
            const isActive = code === locale;
            return (
              <li key={code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    pick(code);
                  }}
                  className={[
                    "flex w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm transition-colors",
                    isActive
                      ? "bg-[rgb(var(--bg-overlay))] text-[rgb(var(--fg-primary))]"
                      : "text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))]",
                  ].join(" ")}
                >
                  <span>{LOCALE_META[code].label}</span>
                  <span className="font-mono text-[0.62rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                    {LOCALE_META[code].short}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
