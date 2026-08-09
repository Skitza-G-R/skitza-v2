"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { useTabSwipe } from "~/components/native/use-tab-swipe";

import { CalendarTabs } from "./calendar-tabs";
import type { CalendarTabKey } from "./calendar-tab-key";
import { ManualSessionModal } from "./manual-session-modal";
import type { ProducerManualSessionOptions } from "~/server/domain/session-booking/manual";

const CALENDAR_SWIPE_ITEMS = ["sessions", "availability"] as const;
type CalendarSwipeItem = (typeof CALENDAR_SWIPE_ITEMS)[number];

export function normalizeCalendarSwipeItem(active: CalendarTabKey): CalendarSwipeItem {
  return active === "availability" ? "availability" : "sessions";
}

export function CalendarSwipeSurface({
  active,
  eyebrows,
  scheduleEyebrow,
  sessionsContent,
  availabilityContent,
  manualOptions,
  googleCalendarControl,
}: {
  active: CalendarTabKey;
  eyebrows: Record<CalendarTabKey, string>;
  scheduleEyebrow: string;
  sessionsContent: ReactNode;
  availabilityContent: ReactNode;
  manualOptions: ProducerManualSessionOptions;
  googleCalendarControl?: ReactNode;
}) {
  const router = useRouter();
  const [optimistic, setOptimistic] = useState<{
    source: CalendarTabKey;
    value: CalendarSwipeItem;
  } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const displayActive: CalendarTabKey = optimistic?.source === active ? optimistic.value : active;
  const displaySwipeItem = normalizeCalendarSwipeItem(displayActive);
  const sessionsActive = displaySwipeItem === "sessions";
  const sessionsPanelKey: CalendarTabKey =
    sessionsActive && displayActive === "schedule" ? "schedule" : "sessions";

  const swipeHandlers = useTabSwipe({
    items: CALENDAR_SWIPE_ITEMS,
    value: displaySwipeItem,
    onChange(next) {
      setOptimistic({ source: active, value: next });
      router.push(`/dashboard/calendar?tab=${next}`, { scroll: false });
    },
  });

  return (
    <>
      <header className="reveal-up mb-2 shrink-0 sm:mb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="flex min-w-0 items-center justify-between gap-3 sm:justify-start">
            <div className="flex min-w-0 items-baseline gap-3">
              <h1
                className="reveal-up font-display leading-[0.95]"
                style={{
                  fontSize: "clamp(22px, 2.6vw, 30px)",
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                }}
              >
                Calendar
              </h1>
              <p
                key={`eyebrow-${displayActive}`}
                className={[
                  "reveal-up truncate font-mono text-[10px] tracking-[0.16em] text-[rgb(var(--fg-muted))]",
                  displayActive === "sessions" ? "lg:hidden" : "",
                ].join(" ")}
                style={{ fontWeight: 700 }}
              >
                {eyebrows[displayActive]}
              </p>
              {displayActive === "sessions" ? (
                <p
                  className="reveal-up hidden truncate font-mono text-[10px] tracking-[0.16em] text-[rgb(var(--fg-muted))] lg:block"
                  style={{ fontWeight: 700 }}
                >
                  {scheduleEyebrow}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setManualOpen(true);
              }}
              className="sk-cta-press inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-bold text-[rgb(var(--bg-sidebar))] sm:hidden"
            >
              <span aria-hidden className="text-lg leading-none">
                +
              </span>
              New session
            </button>
          </div>
          <div className="flex items-center gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => {
                setManualOpen(true);
              }}
              className="sk-cta-press hidden h-11 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-bold text-[rgb(var(--bg-sidebar))] sm:inline-flex"
            >
              <span aria-hidden className="text-lg leading-none">
                +
              </span>
              New session
            </button>
            <CalendarTabs active={displayActive} />
            {googleCalendarControl}
          </div>
        </div>
      </header>

      <ManualSessionModal open={manualOpen} onOpenChange={setManualOpen} options={manualOptions} />

      <div
        data-tab-swipe-surface
        {...swipeHandlers}
        className="reveal-up flex min-h-0 flex-1 [touch-action:pan-y_pinch-zoom] flex-col overflow-x-clip"
      >
        <div
          className="relative flex min-h-0 flex-1 flex-col"
          data-tab-swipe-panel
          data-calendar-swipe-track
          data-calendar-swipe-active={displaySwipeItem}
        >
          <section
            data-calendar-swipe-item="sessions"
            id={`calendar-panel-${sessionsPanelKey}`}
            role="tabpanel"
            aria-labelledby={`calendar-tab-${sessionsPanelKey}`}
            aria-hidden={!sessionsActive}
            inert={!sessionsActive}
            className={[
              "flex min-h-0 min-w-0 flex-1 flex-col",
              sessionsActive
                ? "relative"
                : "pointer-events-none absolute inset-x-0 top-0 min-h-full",
            ].join(" ")}
          >
            {sessionsContent}
          </section>
          <section
            data-calendar-swipe-item="availability"
            id="calendar-panel-availability"
            role="tabpanel"
            aria-labelledby="calendar-tab-availability"
            aria-hidden={sessionsActive}
            inert={sessionsActive}
            className={[
              "flex min-h-0 min-w-0 flex-1 flex-col",
              sessionsActive
                ? "pointer-events-none absolute inset-x-0 top-0 min-h-full"
                : "relative",
            ].join(" ")}
          >
            {availabilityContent}
          </section>
        </div>
      </div>
    </>
  );
}
