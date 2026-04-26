import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PROJECT_SUB_TAB_LABELS,
  buildSubTabHref,
  panelDataAttrs,
  tabAriaProps,
  PROJECT_SUB_TABS,
  __TEST_ONLY__,
} from "../project-sub-tabs";
import type { ProjectSubTabId } from "../project-sub-tab-shared";

// Story 03 — Project Room sub-tab refactor.
//
// Repo testing convention (CLAUDE.md): vitest runs in `node` env, no
// jsdom + no React Testing Library. We pin the contract via pure
// helpers exported from project-sub-tabs.tsx + a source-string
// invariant that catches the most common regressions:
//
//   1. Tab list (4 tabs, Dashboard first / default).
//   2. ARIA wiring (id="tab-<key>" + aria-controls="panel-<key>" on
//      the button; id="panel-<key>" + aria-labelledby="tab-<key>" on
//      the panel — both IDs match).
//   3. data-active toggle controls panel visibility (the CSS rule
//      [role="tabpanel"][data-active="false"] { display: none } is
//      asserted in the globals-css invariant test).
//   4. Tab change is shallow (router.replace + scroll: false) — pin
//      via a source-text grep.
//   5. No `key={activeTab}` on the panel container (the React-remount
//      kill from the architecture doc) — pin via a source-text grep.
//   6. Reveal-up animation runs ONCE per panel mount, not per tab
//      change — pin via the `data-mounted` attribute discipline.
//   7. Dev-only perf probe wired up (warns at >150ms).

const SUB_TABS_SRC = readFileSync(
  new URL("../project-sub-tabs.tsx", import.meta.url),
  "utf8",
);

describe("PROJECT_SUB_TABS list (Story 03 — 4 tabs, Dashboard first)", () => {
  it("exposes exactly 4 tabs, dashboard first (default tab per PRD §4.2)", () => {
    expect(PROJECT_SUB_TABS).toHaveLength(4);
    expect(PROJECT_SUB_TABS.map((t) => t.id)).toEqual([
      "dashboard",
      "music",
      "sessions",
      "money",
    ]);
  });

  it("does NOT include the retired 'notes' tab", () => {
    expect(PROJECT_SUB_TABS.map((t) => t.id)).not.toContain("notes");
  });

  it("each tab carries a producer-facing label", () => {
    for (const tab of PROJECT_SUB_TABS) {
      expect(typeof tab.label).toBe("string");
      expect(tab.label.length).toBeGreaterThan(0);
    }
  });

  it("PROJECT_SUB_TAB_LABELS exposes the same 4 label strings", () => {
    expect(Object.keys(PROJECT_SUB_TAB_LABELS).sort()).toEqual([
      "dashboard",
      "money",
      "music",
      "sessions",
    ]);
  });
});

describe("buildSubTabHref — shallow URL update for tab change", () => {
  // The architecture-doc fix (a) replaces <Link href> with router.replace
  // (url, { scroll: false }). The href construction must mirror the
  // browser's URL behaviour so middle-click + back/forward also work
  // when a producer types ?tab=music manually.

  it("preserves the project pathname and sets ?tab=<id>", () => {
    const href = buildSubTabHref({
      pathname: "/dashboard/projects/abc-123",
      searchParams: new URLSearchParams(),
      tab: "music",
    });
    expect(href).toBe("/dashboard/projects/abc-123?tab=music");
  });

  it("preserves OTHER existing search params (e.g. ?focus=track-1)", () => {
    const href = buildSubTabHref({
      pathname: "/dashboard/projects/abc-123",
      searchParams: new URLSearchParams("focus=track-1"),
      tab: "money",
    });
    // Order is whichever URLSearchParams produces — both keys must be
    // present, and the tab must carry the new value.
    const url = new URL(`http://_${href}`);
    expect(url.pathname).toBe("/dashboard/projects/abc-123");
    expect(url.searchParams.get("focus")).toBe("track-1");
    expect(url.searchParams.get("tab")).toBe("money");
  });

  it("OVERWRITES an existing ?tab= rather than appending", () => {
    const href = buildSubTabHref({
      pathname: "/dashboard/projects/abc-123",
      searchParams: new URLSearchParams("tab=music"),
      tab: "sessions",
    });
    const url = new URL(`http://_${href}`);
    expect(url.searchParams.getAll("tab")).toEqual(["sessions"]);
  });
});

describe("tabAriaProps — id + aria-controls + aria-current wiring", () => {
  // Per CLAUDE.md ARIA conventions:
  //   - tab button: id="tab-<key>" + aria-controls="panel-<key>"
  //   - panel:      id="panel-<key>" + aria-labelledby="tab-<key>"
  //   - active tab: aria-current="page" (NOT aria-pressed — that's
  //     for toggles)

  it("returns matching id + aria-controls for every tab id", () => {
    for (const id of [
      "dashboard",
      "music",
      "sessions",
      "money",
    ] as const) {
      const props = tabAriaProps(id, false);
      expect(props.id).toBe(`tab-${id}`);
      expect(props["aria-controls"]).toBe(`panel-${id}`);
    }
  });

  it("uses aria-current='page' on the active tab (NOT aria-pressed)", () => {
    const active = tabAriaProps("dashboard", true);
    expect(active["aria-current"]).toBe("page");
    expect("aria-pressed" in active).toBe(false);
  });

  it("does NOT set aria-current on inactive tabs", () => {
    const inactive = tabAriaProps("dashboard", false);
    expect(inactive["aria-current"]).toBeUndefined();
  });

  it("aria-selected reflects the active flag", () => {
    expect(tabAriaProps("music", true)["aria-selected"]).toBe(true);
    expect(tabAriaProps("music", false)["aria-selected"]).toBe(false);
  });
});

describe("panelDataAttrs — data-active + ARIA wiring", () => {
  // The panel side of the contract: id="panel-<key>",
  // aria-labelledby="tab-<key>", and data-active toggles visibility.
  // The CSS rule `[role="tabpanel"][data-active="false"] { display:
  // none }` (asserted in globals-css.test) does the actual hide.

  it("sets matching panel ID + aria-labelledby for the tab id", () => {
    const props = panelDataAttrs("music", false);
    expect(props.id).toBe("panel-music");
    expect(props["aria-labelledby"]).toBe("tab-music");
  });

  it("data-active='true' for the active tab, 'false' for inactive", () => {
    expect(panelDataAttrs("dashboard", true)["data-active"]).toBe("true");
    expect(panelDataAttrs("dashboard", false)["data-active"]).toBe("false");
  });

  it("role is 'tabpanel' on every panel (CSS hide rule keys off this)", () => {
    expect(panelDataAttrs("money", true).role).toBe("tabpanel");
    expect(panelDataAttrs("money", false).role).toBe("tabpanel");
  });
});

describe("Source invariants — the architecture-doc fixes are wired up", () => {
  // These are the three stacking changes from §7 of the architecture
  // doc. Each pin guards against a regression that would silently
  // restore the 5-second-tab-switch behaviour.

  it("uses router.replace with scroll: false (NOT <Link>) for tab change", () => {
    // Fix (a): shallow client-side URL update. <Link> would re-run the
    // server page; router.replace doesn't.
    expect(SUB_TABS_SRC).toMatch(/router\.replace\(/);
    expect(SUB_TABS_SRC).toMatch(/scroll:\s*false/);
    // Soft check: <Link> imported from 'next/link' would re-introduce
    // the per-tab navigation. The previous wiring imported it; the
    // new wiring must not.
    expect(SUB_TABS_SRC).not.toMatch(/from\s+["']next\/link["']/);
  });

  it("does NOT key the panel container on activeTab (no React remount)", () => {
    // Fix (b): the old code wrapped panels in <div key={activeTab}>
    // which forced a full unmount + mount on every tab change. The
    // new code MUST NOT use that idiom — audio playback / scroll /
    // in-progress uploads survive only when the panel keeps its
    // identity across switches.
    expect(SUB_TABS_SRC).not.toMatch(/key=\{activeTab\}/);
  });

  it("hides inactive panels via data-active='false' (NOT conditional render)", () => {
    // The 4 panels are mounted at all times. The DOM-level toggle is a
    // single string attribute consumed by the globals.css rule. If
    // someone reverts to `{activeTab === 'music' && <MusicPanel />}`
    // the audio-continuity acceptance criterion breaks.
    expect(SUB_TABS_SRC).toMatch(/data-active=/);
  });

  it("wires the dev-only perf probe (warns at >150ms tab switch)", () => {
    // The 150ms target is the §11.7 PRD performance contract. Probe
    // must be gated on NODE_ENV === 'development' so production
    // bundles don't ship the warning.
    expect(SUB_TABS_SRC).toMatch(/process\.env\.NODE_ENV/);
    expect(SUB_TABS_SRC).toMatch(/requestAnimationFrame/);
    expect(SUB_TABS_SRC).toMatch(/150/);
  });

  it("uses :focus-visible (NOT :focus) for keyboard rings", () => {
    // CLAUDE.md UI rule: keyboard focus rings via focus-visible so
    // mouse clicks don't trigger them.
    expect(SUB_TABS_SRC).toMatch(/focus-visible:/);
  });

  it("never references hex colors (CSS-vars-only repo rule)", () => {
    // Strip out anchor-tag-ID references (#tab-music etc.) before the
    // hex check — those aren't colors.
    const stripped = SUB_TABS_SRC.replace(/#tab-[a-z]+|#panel-[a-z]+/g, "");
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("touch target stays ≥ 44px on mobile (CLAUDE.md mobile rule)", () => {
    expect(SUB_TABS_SRC).toMatch(/min-h-\[44px\]|sk-tap/);
  });
});

describe("Source invariant — no remount across tab switches (Story 03 §10.4)", () => {
  // Architecture §10.4 acceptance: audio playback continuity. Play a
  // track in Music, switch to Dashboard, switch back — audio still
  // plays at the same time position. Only achievable when the panel
  // tree never unmounts. The pure-helper proof: panelDataAttrs
  // returns the SAME role + id + aria-labelledby regardless of
  // active-state — only data-active flips. A remount would change
  // the React identity of the subtree.
  it("panelDataAttrs identity is stable across active flips", () => {
    const id: ProjectSubTabId = "music";
    const active = panelDataAttrs(id, true);
    const inactive = panelDataAttrs(id, false);
    expect(active.id).toBe(inactive.id);
    expect(active.role).toBe(inactive.role);
    expect(active["aria-labelledby"]).toBe(inactive["aria-labelledby"]);
    // Only data-active differs — that's what the CSS rule reads.
    expect(active["data-active"]).not.toBe(inactive["data-active"]);
  });
});

describe("globals.css invariant — display:none rule for inactive panels", () => {
  // The hide rule lives in globals.css so it's available everywhere a
  // [role="tabpanel"][data-active="false"] tuple appears (not just the
  // Project Room — any future tab strip can opt in by adopting the
  // same data attribute discipline). Use display:none, NOT
  // visibility:hidden — see architecture §10.4 fallback note.
  const GLOBALS_CSS = readFileSync(
    new URL("../../../../app/globals.css", import.meta.url),
    "utf8",
  );

  it("declares the [role='tabpanel'][data-active='false'] { display: none } rule", () => {
    // Be lenient on whitespace / quote style — the rule itself is the
    // contract.
    expect(GLOBALS_CSS).toMatch(
      /\[role=["']tabpanel["']\]\[data-active=["']false["']\]\s*\{[^}]*display:\s*none/,
    );
  });
});

describe("revealOnFirstMount helper (Story 03 — animation runs once)", () => {
  // The reveal-up animation should fire once per panel on first paint
  // — NOT every tab change. Idiom: a `data-mounted` flag that flips
  // from "false" → "true" on the first activation, and stays "true"
  // forever. The pure helper computes the next value of the flag
  // given (currentlyMounted, isActiveNow). Once it's true, it stays
  // true.
  const { nextMountedFlag } = __TEST_ONLY__;

  it("flips false → true the first time the panel is active", () => {
    expect(nextMountedFlag(false, true)).toBe(true);
  });

  it("stays false while the panel has never been active", () => {
    expect(nextMountedFlag(false, false)).toBe(false);
  });

  it("stays true once it has flipped to true (sticky)", () => {
    expect(nextMountedFlag(true, true)).toBe(true);
    expect(nextMountedFlag(true, false)).toBe(true);
  });
});
