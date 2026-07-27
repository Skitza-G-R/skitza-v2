"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { useTabSwipe } from "~/components/native/use-tab-swipe";

import type { CalendarTabKey } from "./calendar-tab-key";

const CALENDAR_SWIPE_ITEMS = ["sessions", "availability"] as const;
type CalendarSwipeItem = (typeof CALENDAR_SWIPE_ITEMS)[number];

export function normalizeCalendarSwipeItem(
  active: CalendarTabKey,
): CalendarSwipeItem {
  return active === "availability" ? "availability" : "sessions";
}

export function CalendarSwipeSurface({
  active,
  children,
}: {
  active: CalendarTabKey;
  children: ReactNode;
}) {
  const router = useRouter();
  const swipeHandlers = useTabSwipe({
    items: CALENDAR_SWIPE_ITEMS,
    value: normalizeCalendarSwipeItem(active),
    onChange(next) {
      router.push(`/dashboard/calendar?tab=${next}`, { scroll: false });
    },
  });

  return (
    <div
      data-tab-swipe-surface
      {...swipeHandlers}
      id={`calendar-panel-${active}`}
      role="tabpanel"
      aria-labelledby={`calendar-tab-${active}`}
      className="reveal-up flex min-h-0 flex-1 [touch-action:pan-y_pinch-zoom] flex-col"
    >
      {children}
    </div>
  );
}
