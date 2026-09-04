"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";
import { getActiveKey, type ActiveKey } from "~/lib/dashboard/active-key";
import {
  announceRuntimeMainNavigationIntent,
  captureRuntimeMainNavigationTarget,
} from "~/lib/runtime-state/navigation-cache";

import { type IconName } from "./icons";
import { LiquidGlassBottomNav, type LiquidGlassBottomNavTab } from "./liquid-glass-bottom-nav";

type ProducerMobileTab = {
  id: ActiveKey;
  label: string;
  href: string;
  icon: IconName;
};

const PROD_TABS: readonly ProducerMobileTab[] = [
  { id: "today", label: "Today", href: "/dashboard", icon: "home" },
  { id: "music", label: "Music", href: "/dashboard/music", icon: "music" },
  { id: "clients-projects", label: "Clients", href: "/dashboard/clients-projects", icon: "users" },
  { id: "calendar", label: "Calendar", href: "/dashboard/calendar?tab=sessions", icon: "calendar" },
  // SK-306: Store took the fifth slot from Payments. Producers reach for the
  // store (products and private offers) far more often than the payments
  // workspace, so Payments moved into the mobile account sheet instead.
  { id: "profile", label: "Store", href: "/dashboard/store", icon: "store" },
] as const;

const OFFLINE_MESSAGE = "You’re offline. This screen will stay open until you reconnect.";

/**
 * Producer adapter for the shared liquid-glass surface. The nav stays inside
 * the fixed producer shell's flex column, while the adapter retains the
 * producer-only offline guard. Home opts into Next's lightweight default
 * prefetch while the runtime bridge keeps full-route warming serial.
 */
export function ProducerBottomNav(): ReactNode {
  const pathname = usePathname();
  const online = useOnlineStatus();
  const { toast } = useToast();
  const active = getActiveKey(pathname);
  const tabs: readonly LiquidGlassBottomNavTab<ActiveKey>[] = PROD_TABS.map((tab) => ({
    ...tab,
    active: active === tab.id,
    prefetch: tab.id === "today" ? null : false,
    navigationBlocked: !online,
  }));

  return (
    <LiquidGlassBottomNav
      ariaLabel="Producer tabs"
      tabs={tabs}
      position="in-flow"
      frameClassName="producer-bottom-nav-frame"
      onTabClick={(event) => {
        captureRuntimeMainNavigationTarget(event.currentTarget);
      }}
      onTabNavigate={(tab) => {
        announceRuntimeMainNavigationIntent(tab.href);
      }}
      onNavigationBlocked={() => {
        toast(OFFLINE_MESSAGE, "error");
      }}
    />
  );
}
