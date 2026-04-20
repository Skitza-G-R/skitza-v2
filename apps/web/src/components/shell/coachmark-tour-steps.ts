// Pure step-machine for the producer first-run coachmark tour. Kept
// separate from the component so vitest (node env) can exercise the
// state transitions + localStorage flag without pulling in React or
// jsdom.
//
// A "step" is either:
//   - a centered modal (no spotlight target, just a tooltip card in
//     the middle of the screen) — for the welcome + closing cards;
//   - a spotlight step, which names a `targetId` that the runtime
//     will look up via `document.querySelector('[data-tour-id=...]')`
//     at mount time. Missing targets fall through to the next step
//     (so a tour dispatched on a page that's lost a pinned element
//     never bricks).
//
// The machine itself is index-based: next/back move through the
// STEPS array, skip and finish both write the localStorage seen-flag
// and end the tour. Exporting `STEPS` + the pure helpers lets the
// component stay mostly a renderer.

export type TourStep = {
  id: string;
  /**
   * Element id looked up via `data-tour-id` at mount time. Omit for
   * centered-modal steps that don't highlight anything on the page.
   */
  targetId?: string;
  title: string;
  body: string;
  /** Copy for the primary advance button. Defaults to "Next" in render. */
  nextLabel?: string;
  /**
   * Where to pin the tooltip card relative to the spotlight. `auto`
   * picks the side with the most available space. Ignored for
   * centered-modal steps (they always render in the viewport center).
   */
  side?: "auto" | "top" | "bottom" | "left" | "right";
};

// 7 steps exactly — centered welcome, 5 spotlighted features, centered
// closing card. Order matches the brief.
export const STEPS: readonly TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to Skitza",
    body:
      "Let's take 30 seconds to show you around. You'll be producing faster by the end.",
    nextLabel: "Start tour",
  },
  {
    id: "four-screens",
    targetId: "sidebar-nav",
    side: "right",
    title: "Your 4 screens",
    body:
      "Today is your daily cockpit. Projects are every engagement. Music is your track library. Setup is where Autopilot + Services live.",
  },
  {
    id: "share-link",
    targetId: "share-link-card",
    side: "bottom",
    title: "Your permanent share link",
    body:
      "Put this in your Instagram bio. Anyone who clicks can listen to your portfolio, sign up, and book — no manual client creation needed.",
  },
  {
    id: "quick-actions",
    targetId: "quick-actions",
    side: "bottom",
    title: "Everything you do, one click away",
    body:
      "Copy link, upload, new booking, send invoice — all on Today. Skip the navigation.",
  },
  {
    id: "today-inbox",
    targetId: "today-inbox",
    side: "top",
    title: "Your daily inbox",
    body:
      "Sessions, comments, invoices, leads — sorted by urgency. Click one to see details on the right.",
  },
  {
    id: "project-room",
    targetId: "nav-projects",
    side: "right",
    title: "Deep work lives in the Project Room",
    body:
      "Music, sessions, money, notes — all organized per engagement. Open one to see.",
  },
  {
    id: "command-k",
    title: "Press ⌘K anywhere",
    body:
      "Jump to any screen, search any client, run any command. You'll rarely touch a menu again.",
    nextLabel: "I'm ready →",
  },
] as const;

export const TOUR_STORAGE_KEY = "skitza:producer-tour-seen:v1";

/** Immutable view of where the machine is — what render() uses. */
export type TourState = {
  /** -1 = closed/not running; 0..STEPS.length-1 = an active step. */
  index: number;
};

export const CLOSED: TourState = { index: -1 };

export function isClosed(s: TourState): boolean {
  return s.index < 0 || s.index >= STEPS.length;
}

export function start(): TourState {
  return { index: 0 };
}

/** Returns the NEXT state after an advance. Finishing ⟹ CLOSED. */
export function next(s: TourState): TourState {
  if (isClosed(s)) return s;
  const n = s.index + 1;
  if (n >= STEPS.length) return CLOSED;
  return { index: n };
}

/** Returns the PREVIOUS state. Back from first step stays on step 0. */
export function back(s: TourState): TourState {
  if (isClosed(s)) return s;
  if (s.index === 0) return s;
  return { index: s.index - 1 };
}

/** Skip/finish/escape: always go to CLOSED. */
export function skip(): TourState {
  return CLOSED;
}

export function currentStep(s: TourState): TourStep | null {
  if (isClosed(s)) return null;
  return STEPS[s.index] ?? null;
}

// ── localStorage flag helpers ───────────────────────────────────────
// These are thin wrappers so the component + unit tests share one
// source of truth on the key shape. Both tolerate a missing/broken
// `localStorage` (Safari private mode) — if reads throw we treat the
// user as "not seen" so the worst case is replaying the tour, never
// blocking them out of the app.

export type StorageLike = {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
};

export function hasSeenTour(storage: StorageLike | null | undefined): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(TOUR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markTourSeen(storage: StorageLike | null | undefined): void {
  if (!storage) return;
  try {
    storage.setItem(TOUR_STORAGE_KEY, "1");
  } catch {
    // Private-mode/unavailable — silently swallow.
  }
}

export function clearTourSeen(storage: StorageLike | null | undefined): void {
  if (!storage) return;
  try {
    storage.removeItem(TOUR_STORAGE_KEY);
  } catch {
    // Same story.
  }
}
