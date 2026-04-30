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

    // Clients & Projects sub-tree — list, new, and per-project room
    // all roll up under the Clients & Projects nav (renamed from
    // Projects in P2-A-7 to match the PRD's 6-page producer surface).
    ["/dashboard/clients-projects", "clients-projects"],
    ["/dashboard/clients-projects/new", "clients-projects"],
    ["/dashboard/clients-projects/abc123", "clients-projects"],
    ["/dashboard/clients-projects/abc123/music", "clients-projects"],

    // Calendar + Profile are top-level pages added in P2-A-7 (PRD §4).
    ["/dashboard/calendar", "calendar"],
    ["/dashboard/profile", "profile"],

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
