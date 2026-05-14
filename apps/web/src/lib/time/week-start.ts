"use client";

// Producer-wide "week starts on" preference.
//
// Display-only knob for components that render a 7-day grid (Calendar
// availability, onboarding availability step, etc.). The DB keeps the
// JavaScript convention of weekday = 0..6 with Sunday = 0; this hook
// just rotates the visible order so Mon-first producers see the week
// the way they think about it.
//
// Persisted to localStorage so the choice survives reloads without a
// schema change. All consumers read the same key so flipping the
// preference in one place updates the other on next mount.

import { useEffect, useState } from "react";

export type WeekStart = "sunday" | "monday";
export const WEEK_START_KEY = "skitza:week-starts-on";

export function useWeekStartPref(): [WeekStart, (next: WeekStart) => void] {
  const [value, setValue] = useState<WeekStart>("sunday");

  // Hydrate after mount — reading localStorage at render time would
  // mismatch SSR (server has no localStorage) and flash the wrong pick.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(WEEK_START_KEY);
      if (stored === "sunday" || stored === "monday") {
        setValue(stored);
      }
    } catch {
      // Private mode / disabled storage — stick with the default.
    }
  }, []);

  const update = (next: WeekStart) => {
    setValue(next);
    try {
      window.localStorage.setItem(WEEK_START_KEY, next);
    } catch {
      // ignore
    }
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
