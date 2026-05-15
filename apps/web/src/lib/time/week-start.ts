"use client";

// Producer-wide "week starts on" preference.
//
// Display knob for components that render a 7-day grid (Calendar
// availability panel, onboarding availability step, Settings →
// Language & region). The DB column `producers.week_start` is the
// source of truth — settings made on one device show up on the next
// device, and the same value flows into every surface that renders
// the week.
//
// History: this used to be a localStorage-only knob (PR #114). The
// settings redesign (PR #116) moved the source of truth to the DB
// so the choice syncs across devices. Callers now pass the current
// value in as `initial` (read server-side from `producer.me().weekStart`)
// and the setter writes back via the existing `updateProducer` action
// — which revalidates `/dashboard/calendar` and `/onboarding/availability`
// so other tabs see the new value on next visit.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateProducer } from "~/app/(producer)/dashboard/settings/actions";

export type WeekStart = "sunday" | "monday";

// Returns the current value + a setter that optimistically updates
// local state, then persists to the DB via updateProducer. On error
// we revert silently — the caller can wrap the setter in their own
// pending/toast logic if they want richer feedback.
//
// `initial` is REQUIRED so SSR + first paint match the DB value.
// Pass `profile.weekStart` from a server component that fetched
// `producer.me()`.
export function useWeekStartPref(
  initial: WeekStart,
): [WeekStart, (next: WeekStart) => void] {
  const router = useRouter();
  const [value, setValue] = useState<WeekStart>(initial);
  const [, startTransition] = useTransition();

  const update = (next: WeekStart) => {
    if (next === value) return;
    const prev = value;
    setValue(next); // optimistic — UI rotates immediately
    startTransition(async () => {
      const res = await updateProducer({ weekStart: next });
      if (!res.ok) {
        // Revert local state on server error.
        setValue(prev);
      } else {
        // Pull fresh server data so any sibling surface that reads
        // weekStart (e.g. another tab showing Settings) sees the
        // new value too.
        router.refresh();
      }
    });
  };

  return [value, update];
}

// Rotate a Sunday-first array so Monday leads when the preference is
// "monday". Generic so it works for any per-weekday data shape.
//
// Input is expected to be ordered [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
// (length 7). slice/spread avoids index-based access so we don't need
// non-null assertions to satisfy the type checker.
export function orderByWeekStart<T>(
  daysSunFirst: readonly T[],
  start: WeekStart,
): readonly T[] {
  if (start === "monday") {
    return [...daysSunFirst.slice(1), ...daysSunFirst.slice(0, 1)];
  }
  return daysSunFirst;
}
