import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  isProjectSubTabId,
  PROJECT_SUB_TAB_IDS,
  resolveProjectSubTab,
  VISIBLE_PROJECT_SUB_TAB_IDS,
  type ProjectSubTabId,
} from "../project-sub-tab-shared";

// Regression tests for the 2026-04-23 "Something buzzed" crash on
// /dashboard/projects/[id] — see docs/audit-report.md Task 18.
//
// The bug: `isProjectSubTabId` used to live in `project-sub-tabs.tsx`,
// which is a client component (`"use client"` at top). The server
// component at `app/(app)/dashboard/projects/[id]/page.tsx` imported
// and CALLED it. React Server Components forbids invoking a function
// defined in a client module from server code, so every producer
// hitting a project page got the root error boundary ("Something
// buzzed"). The fix is to move the pure type-guard + shared types
// into a server-safe module (this file's target), leaving the
// client-only UI bits in the original `.tsx`.

describe("project-sub-tab-shared — type-guard behavior", () => {
  it("accepts every known sub-tab id", () => {
    for (const id of PROJECT_SUB_TAB_IDS) {
      expect(isProjectSubTabId(id)).toBe(true);
    }
  });

  it("rejects strings that aren't known sub-tab ids", () => {
    expect(isProjectSubTabId("garbage")).toBe(false);
    expect(isProjectSubTabId("")).toBe(false);
    expect(isProjectSubTabId("Music")).toBe(false); // case-sensitive
    expect(isProjectSubTabId("payments")).toBe(false);
  });

  it("rejects null + undefined safely", () => {
    expect(isProjectSubTabId(null)).toBe(false);
    expect(isProjectSubTabId(undefined)).toBe(false);
  });

  it("exposes PROJECT_SUB_TAB_IDS as the canonical id set (incl. money alias)", () => {
    // Pin the literal tuple so a reorder / rename (e.g. if someone
    // adds a "contracts" tab later) trips this test first and forces
    // them to update the enum/URL handling together. `money` is kept
    // in the accepted-id set as a legacy alias even though it's not
    // visible in the tab strip — the resolver maps it to "overview".
    expect([...PROJECT_SUB_TAB_IDS]).toEqual([
      "overview",
      "music",
      "sessions",
      "files",
      "notes",
      "money",
    ]);
  });

  it("exposes VISIBLE_PROJECT_SUB_TAB_IDS as the 5 PRD-spec tabs in order", () => {
    // PRD §3.2 (May 2026): Project Room ships with 5 explicit tabs.
    // Reordering or removing any of them needs a coordinated change
    // across the tab strip + every deep-link in the codebase.
    expect([...VISIBLE_PROJECT_SUB_TAB_IDS]).toEqual([
      "overview",
      "music",
      "sessions",
      "files",
      "notes",
    ]);
  });
});

describe("project-sub-tab-shared — resolveProjectSubTab", () => {
  it("returns 'overview' as the default when ?tab is absent or garbage", () => {
    expect(resolveProjectSubTab(undefined)).toBe("overview");
    expect(resolveProjectSubTab("")).toBe("overview");
    expect(resolveProjectSubTab("nope")).toBe("overview");
  });

  it("preserves valid visible tab ids", () => {
    expect(resolveProjectSubTab("overview")).toBe("overview");
    expect(resolveProjectSubTab("music")).toBe("music");
    expect(resolveProjectSubTab("sessions")).toBe("sessions");
    expect(resolveProjectSubTab("files")).toBe("files");
    expect(resolveProjectSubTab("notes")).toBe("notes");
  });

  it("maps the legacy 'money' alias onto 'overview'", () => {
    // Pre-PRD-v3 the Project Room had a standalone Money tab. Deep-
    // links from old recap docs / shared chat threads point at
    // ?tab=money and shouldn't 404 — they should land on Overview,
    // where the same 3 numbers (paid / outstanding / next charge)
    // now live as a strip.
    expect(resolveProjectSubTab("money")).toBe("overview");
  });

  it("handles array values from URLSearchParams gracefully", () => {
    expect(resolveProjectSubTab(["music", "files"])).toBe("music");
    expect(resolveProjectSubTab([])).toBe("overview");
  });
});

describe("project-sub-tab-shared — module is server-safe", () => {
  it("does NOT start with 'use client' directive", () => {
    // Invariant: this module is imported by the server page
    // (app/(app)/dashboard/projects/[id]/page.tsx). If someone
    // future-proofs it by co-locating a hook or UI primitive here
    // and flips it to a client module, the server page will crash
    // with the same "Attempted to call X from the server" error
    // we saw in prod on 2026-04-23. This test pins that invariant.
    const src = readFileSync(
      new URL("../project-sub-tab-shared.ts", import.meta.url),
      "utf8",
    );
    const firstNonEmptyLine = src.split("\n").find((l) => l.trim().length > 0);
    expect(firstNonEmptyLine?.trim().startsWith('"use client"')).toBe(false);
  });
});

// Compile-time sanity: the type is usable as a narrow type-guard
// target. No assertion needed — the TypeScript compiler will fail
// typecheck if the guard doesn't narrow correctly.
const _ensureNarrowing = (v: string | null | undefined): ProjectSubTabId => {
  if (isProjectSubTabId(v)) return v;
  return "music";
};
void _ensureNarrowing;
