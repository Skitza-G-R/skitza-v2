"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";
import { getActiveKey, type ActiveKey } from "~/lib/dashboard/active-key";

import { Icon, type IconName } from "./icons";

// ─── Producer mobile bottom nav (<lg) ───────────────────────────────
//
// Replaces the prior light-surface MobileBottomNav (with its centre
// "+" FAB) with the locked design's dark 5-tab bar. Per CLAUDE.md the
// producer surface was historically desktop-only; Raz approved mobile
// producer for v1 (2026-05-05), so this nav is the producer's mobile
// chrome.
//
// Visual: one floating Liquid Glass pill with an amber active lens.
// The transparent outer frame owns the iOS safe-area spacing, so the
// glass surface stays compact and close to the Home Indicator instead
// of reading as a tall opaque footer.
//
// Routes are mapped per Gili's approved Payments navigation — five
// mobile tabs with Store and Settings under the Account menu in the
// mobile top bar. The mobile
// tab shape leans on the design source's `PROD_TABS` (notes/
// shell.producer.jsx).
//
// Active state derivation reuses `getActiveKey()` so the same URL
// triggers the same active state on both mobile + desktop.
//
// Portfolio tab removed 2026-05-15 to keep parity with the desktop
// rail — see producer-sidebar.tsx for the rationale. The
// /dashboard/portfolio route still exists and is reachable from
// inside the Store experience.

type ProducerMobileTab = {
  id: ActiveKey;
  label: string;
  href: string;
  icon: IconName;
};

const PROD_TABS: readonly ProducerMobileTab[] = [
  { id: "today", label: "Today", href: "/dashboard", icon: "home" },
  { id: "clients-projects", label: "Clients", href: "/dashboard/clients-projects", icon: "users" },
  { id: "music", label: "Music", href: "/dashboard/music", icon: "music" },
  // SK-56: phones land on the Sessions tab — the week-grid Schedule
  // tab is desktop-only (useless at 390px, per Gili's mobile audit).
  // Active-state detection is pathname-based, so the query is inert.
  { id: "calendar", label: "Calendar", href: "/dashboard/calendar?tab=sessions", icon: "calendar" },
  { id: "payments", label: "Payments", href: "/dashboard/payments", icon: "payments" },
] as const;

export function ProducerBottomNav(): ReactNode {
  const pathname = usePathname();
  const online = useOnlineStatus();
  const { toast } = useToast();
  const active = getActiveKey(pathname);

  return (
    <div
      // Keep the established shell-footer anchoring from SK-86: the
      // nav stays attached to the fixed app viewport without relying
      // on document-level `position: fixed`. Only this transparent
      // frame occupies the bottom safe area.
      className="producer-bottom-nav-frame relative z-30 shrink-0 lg:hidden"
      style={{
        padding:
          "0 max(12px, env(safe-area-inset-right, 0px)) max(8px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px))",
      }}
    >
      <nav
        role="navigation"
        aria-label="Producer tabs"
        className="producer-bottom-nav__glass mx-auto grid w-full max-w-[420px] grid-cols-5"
      >
        {PROD_TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              prefetch={online}
              aria-disabled={!online}
              onClick={(event) => {
                if (online) return;
                event.preventDefault();
                toast("You’re offline. This screen will stay open until you reconnect.", "error");
              }}
              {...(isActive ? { "aria-current": "page" as const } : {})}
              data-active={isActive ? "true" : "false"}
              className="producer-bottom-nav__tab sk-press relative flex min-w-0 flex-col items-center justify-center gap-1 py-2.5 focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-inset"
              style={{
                minHeight: 68,
                color: isActive ? "rgb(var(--brand-primary))" : "rgb(var(--fg-onsidebar) / 0.68)",
              }}
            >
              <Icon name={tab.icon} size={24} strokeWidth={isActive ? 2.4 : 2} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: isActive ? 700 : 500,
                  letterSpacing: "-0.005em",
                }}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
