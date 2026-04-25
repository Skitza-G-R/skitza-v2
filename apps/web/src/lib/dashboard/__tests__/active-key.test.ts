import { describe, expect, it } from "vitest";

import { getActiveKey } from "../active-key";

// Pure-function unit test for the URL → ActiveKey derivation that
// powers the sidebar's active-state highlight after the persistent
// dashboard layout refactor (2026-04-25).
//
// Before the refactor, each page hard-coded its own `<AppShell
// active="…">` prop and the ActiveKey lived as a per-page literal.
// After the refactor, AppShell + Sidebar drop the prop and Sidebar
// derives the key from `usePathname()`. This test pins the URL
// mapping so a future route addition (e.g. a new `/dashboard/foo`)
// either updates the helper deliberately or trips this test first.

describe("getActiveKey", () => {
  it.each([
    // Today is the bare /dashboard root.
    ["/dashboard", "today"],

    // Music sub-tree.
    ["/dashboard/music", "music"],
    ["/dashboard/music/upload", "music"],

    // Projects sub-tree — list, new, and per-project room all roll
    // up under the Projects nav. Booking does too: there's no top-
    // level Booking nav (PRD §4 — booking is a Projects affordance).
    ["/dashboard/projects", "projects"],
    ["/dashboard/projects/new", "projects"],
    ["/dashboard/projects/abc123", "projects"],
    ["/dashboard/projects/abc123/music", "projects"],
    ["/dashboard/booking", "projects"],
    ["/dashboard/booking/123", "projects"],

    // Setup covers settings + onboarding (which lives under
    // dashboard/onboarding for already-signed-in producers who
    // haven't completed their profile).
    ["/dashboard/settings", "setup"],
    ["/dashboard/settings/account", "setup"],
    ["/dashboard/onboarding", "setup"],

    // Fallback: anything not recognised falls back to "today" so the
    // sidebar always has SOME active state — never an empty rail.
    ["/dashboard/unknown-future-tab", "today"],
    ["/", "today"],
    ["", "today"],
  ] as const)("maps %s → %s", (pathname, expected) => {
    expect(getActiveKey(pathname)).toBe(expected);
  });
});
