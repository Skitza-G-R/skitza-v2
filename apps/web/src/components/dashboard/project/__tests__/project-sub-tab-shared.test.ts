import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  isProjectSubTabId,
  PROJECT_SUB_TAB_IDS,
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
    // Visible label "Payments" still maps to id "money" — the URL
    // didn't migrate, only the rendered label.
    expect(isProjectSubTabId("payments")).toBe(false);
    // "songs" is the visible label for id "music" — same reasoning.
    expect(isProjectSubTabId("songs")).toBe(false);
    // "notes" was retired in 2026-05; bookmarked URLs fall through to
    // the default tab via resolveSubTab().
    expect(isProjectSubTabId("notes")).toBe(false);
  });

  it("rejects null + undefined safely", () => {
    expect(isProjectSubTabId(null)).toBe(false);
    expect(isProjectSubTabId(undefined)).toBe(false);
  });

  it("exposes PROJECT_SUB_TAB_IDS as the 4 canonical ids", () => {
    // Pin the literal tuple so a reorder / rename (e.g. if someone
    // adds a "contracts" tab later) trips this test first and forces
    // them to update the enum/URL handling together. Order matches
    // the rendered pill strip: Overview leads, then Songs (music) /
    // Sessions / Payments (money).
    expect([...PROJECT_SUB_TAB_IDS]).toEqual([
      "overview",
      "music",
      "sessions",
      "money",
    ]);
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
