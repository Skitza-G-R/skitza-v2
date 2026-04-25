import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  pickActions,
  type ActionCard,
  type ContextualActionsProps,
} from "../contextual-actions";
import type { RecentUpload } from "~/server/trpc/routers/producer";

// Story 04 — ContextualActions test strategy.
//
// Repo convention (see autopilot-section.test.tsx): no React Testing
// Library, no jsdom. We unit-test the pure `pickActions` algorithm
// (the load-bearing logic) directly, then source-grep the JSX for
// the style invariants the spec locks down (sk-lift class, brand
// inset hover bar, RTL flip, encoded wa.me URL, anchor vs button
// semantics).
//
// What the algorithm guarantees (from
// docs/plans/stories/today-redesign-04-contextual-actions.md):
//
//   Priority order, top 3 win:
//     1. reply-unresolved        if unresolvedItems > 0
//     2. continue-track          if recentUploads.length > 0
//     3. send-invoice            if activeProjectsCount > 0
//     4. share-link              if shareUrl !== null
//     5. set-slug                if shareUrl === null  (paired fallback)
//     6. add-offline-client      always
//     7. new-project             always
//
//   Always returns exactly 3.
//   Singular vs plural copy on "1 unresolved item" vs "N unresolved items".
//   wa.me URL must encodeURIComponent the share text.

// --- Fixtures ----------------------------------------------------

function uploadFixture(overrides: Partial<RecentUpload> = {}): RecentUpload {
  return {
    versionId: "v_1",
    trackId: "t_1",
    title: "Sunset Mix",
    versionLabel: "v3",
    uploadedAt: new Date("2026-04-25T10:00:00Z"),
    audioUrl: "https://r2.example/audio.mp3",
    durationMs: 180_000,
    projectId: "p_1",
    projectClientName: "Bob",
    projectStage: "in_production",
    unreadComments: 0,
    ...overrides,
  };
}

const SHARE_URL = "https://skitza.app/p/gili-asraf";

function getOrThrow<T>(value: T | undefined, key: string): T {
  if (value === undefined) {
    throw new Error(`expected fixture key "${key}" to be defined`);
  }
  return value;
}

function findCardOrThrow(
  actions: ActionCard[],
  id: ActionCard["id"],
): ActionCard {
  const found = actions.find((a) => a.id === id);
  if (!found) {
    throw new Error(`expected action "${id}" to be present, got ${JSON.stringify(actions.map((a) => a.id))}`);
  }
  return found;
}

// 5+ priority states — each pins a different branch of the algorithm.
// Typed explicitly as ContextualActionsProps so mutable [] arrays
// satisfy the input contract. (Without the ascription, an empty
// `recentUploads: []` literal can be inferred as `never[]` or
// `readonly RecentUpload[]` depending on context.)
const fixtures: Record<string, ContextualActionsProps> = {
  // Producer with everything: top-3 are unresolved + track + invoice.
  fullActiveProducer: {
    unresolvedItems: 4,
    recentUploads: [uploadFixture()],
    activeProjectsCount: 2,
    shareUrl: SHARE_URL,
  },
  // Only unresolved fires — uploads/projects empty, fallbacks fill 2/3.
  unresolvedOnly: {
    unresolvedItems: 3,
    recentUploads: [],
    activeProjectsCount: 0,
    shareUrl: SHARE_URL,
  },
  // Only uploads fire — fallbacks fill 2/3.
  uploadOnly: {
    unresolvedItems: 0,
    recentUploads: [uploadFixture({ title: "Final Master", projectClientName: "Alice" })],
    activeProjectsCount: 0,
    shareUrl: SHARE_URL,
  },
  // Only active-projects fires — fallbacks fill 2/3.
  finalReviewOnly: {
    unresolvedItems: 0,
    recentUploads: [],
    activeProjectsCount: 1,
    shareUrl: SHARE_URL,
  },
  // Day-1 producer with slug set — all 3 cards are fallbacks.
  dayOne: {
    unresolvedItems: 0,
    recentUploads: [],
    activeProjectsCount: 0,
    shareUrl: SHARE_URL,
  },
  // Day-1 producer with NO slug yet — share-link unavailable.
  dayOneNoSlug: {
    unresolvedItems: 0,
    recentUploads: [],
    activeProjectsCount: 0,
    shareUrl: null,
  },
};

// --- 1. Algorithm tests (RED → GREEN) ---------------------------

describe("pickActions — priority order", () => {
  it("full active producer → reply-unresolved + continue-track + send-invoice", () => {
    const actions = pickActions(getOrThrow(fixtures.fullActiveProducer, "fullActiveProducer"));
    expect(actions.map((a) => a.id)).toEqual([
      "reply-unresolved",
      "continue-track",
      "send-invoice",
    ]);
  });

  it("unresolved-only → reply-unresolved + share-link + add-offline-client", () => {
    const actions = pickActions(getOrThrow(fixtures.unresolvedOnly, "unresolvedOnly"));
    expect(actions.map((a) => a.id)).toEqual([
      "reply-unresolved",
      "share-link",
      "add-offline-client",
    ]);
  });

  it("upload-only → continue-track + share-link + add-offline-client", () => {
    const actions = pickActions(getOrThrow(fixtures.uploadOnly, "uploadOnly"));
    expect(actions.map((a) => a.id)).toEqual([
      "continue-track",
      "share-link",
      "add-offline-client",
    ]);
  });

  it("active-projects-only → send-invoice + share-link + add-offline-client", () => {
    const actions = pickActions(getOrThrow(fixtures.finalReviewOnly, "finalReviewOnly"));
    expect(actions.map((a) => a.id)).toEqual([
      "send-invoice",
      "share-link",
      "add-offline-client",
    ]);
  });

  it("day-1 producer with slug → share-link + add-offline-client + new-project", () => {
    const actions = pickActions(getOrThrow(fixtures.dayOne, "dayOne"));
    expect(actions.map((a) => a.id)).toEqual([
      "share-link",
      "add-offline-client",
      "new-project",
    ]);
  });

  it("day-1 producer without slug → set-slug + add-offline-client + new-project", () => {
    const actions = pickActions(getOrThrow(fixtures.dayOneNoSlug, "dayOneNoSlug"));
    // No reply, no continue, no invoice, no share-link (because no
    // slug). Without an extra fallback, we'd only have add-offline-
    // client + new-project — 2 cards, breaking the always-3 contract.
    // The algorithm fills the gap with a slug-setup card that's only
    // emitted when shareUrl is null. Order: set-slug ranks first
    // because for a day-1 producer the highest-leverage next step is
    // the share link itself.
    expect(actions.map((a) => a.id)).toEqual([
      "set-slug",
      "add-offline-client",
      "new-project",
    ]);
  });
});

describe("pickActions — always returns exactly 3", () => {
  it.each(Object.entries(fixtures))(
    "%s → length === 3",
    (_name, props) => {
      expect(pickActions(props)).toHaveLength(3);
    },
  );
});

describe("pickActions — singular/plural copy", () => {
  it("unresolvedItems === 1 → '1 unresolved item' (singular)", () => {
    const actions = pickActions({
      unresolvedItems: 1,
      recentUploads: [],
      activeProjectsCount: 0,
      shareUrl: SHARE_URL,
    });
    const reply = findCardOrThrow(actions, "reply-unresolved");
    expect(reply.description).toBe("1 unresolved item");
  });

  it("unresolvedItems === 2 → '2 unresolved items' (plural)", () => {
    const actions = pickActions({
      unresolvedItems: 2,
      recentUploads: [],
      activeProjectsCount: 0,
      shareUrl: SHARE_URL,
    });
    const reply = findCardOrThrow(actions, "reply-unresolved");
    expect(reply.description).toBe("2 unresolved items");
  });

  it("reply card label includes the count", () => {
    const actions = pickActions({
      unresolvedItems: 7,
      recentUploads: [],
      activeProjectsCount: 0,
      shareUrl: SHARE_URL,
    });
    const reply = findCardOrThrow(actions, "reply-unresolved");
    expect(reply.label).toBe("Reply to 7");
  });
});

describe("pickActions — continue-track uses top upload metadata", () => {
  it("uses recentUploads[0].title in label and projectClientName in description", () => {
    const actions = pickActions({
      unresolvedItems: 0,
      recentUploads: [
        uploadFixture({
          title: "Heatwave",
          projectClientName: "Lena",
          projectId: "p_lena",
        }),
        uploadFixture({ title: "Should-be-ignored" }),
      ],
      activeProjectsCount: 0,
      shareUrl: SHARE_URL,
    });
    const cont = findCardOrThrow(actions, "continue-track");
    expect(cont.label).toBe("Continue with Heatwave");
    expect(cont.description).toBe("In Lena's project");
    expect(cont.href).toBe("/dashboard/projects/p_lena?tab=music");
  });
});

describe("pickActions — hrefs and onClicks", () => {
  it("reply-unresolved navigates to /dashboard?filter=unresolved", () => {
    const actions = pickActions({
      unresolvedItems: 1,
      recentUploads: [],
      activeProjectsCount: 0,
      shareUrl: SHARE_URL,
    });
    const reply = findCardOrThrow(actions, "reply-unresolved");
    expect(reply.href).toBe("/dashboard?filter=unresolved");
  });

  it("send-invoice navigates to /dashboard/projects", () => {
    const actions = pickActions(getOrThrow(fixtures.finalReviewOnly, "finalReviewOnly"));
    const inv = findCardOrThrow(actions, "send-invoice");
    expect(inv.href).toBe("/dashboard/projects");
  });

  it("add-offline-client navigates to /dashboard/projects/new?mode=offline", () => {
    const actions = pickActions(getOrThrow(fixtures.dayOne, "dayOne"));
    const off = findCardOrThrow(actions, "add-offline-client");
    expect(off.href).toBe("/dashboard/projects/new?mode=offline");
  });

  it("new-project navigates to /dashboard/projects/new", () => {
    const actions = pickActions(getOrThrow(fixtures.dayOne, "dayOne"));
    const np = findCardOrThrow(actions, "new-project");
    expect(np.href).toBe("/dashboard/projects/new");
  });

  it("set-slug navigates to /dashboard/settings?section=profile", () => {
    const actions = pickActions(getOrThrow(fixtures.dayOneNoSlug, "dayOneNoSlug"));
    const setSlug = findCardOrThrow(actions, "set-slug");
    expect(setSlug.href).toBe("/dashboard/settings?section=profile");
  });

  it("share-link is an onClick handler (not an href)", () => {
    const actions = pickActions(getOrThrow(fixtures.dayOne, "dayOne"));
    const share = findCardOrThrow(actions, "share-link");
    expect(share.onClick).toBeTypeOf("function");
    expect(share.href).toBeUndefined();
  });
});

// --- 2. share-link wa.me URL encoding (RED → GREEN) -------------

describe("pickActions — share-link wa.me URL encoding", () => {
  let openSpy: ReturnType<typeof vi.fn>;
  let originalOpen: typeof window.open | undefined;

  beforeEach(() => {
    // jsdom is not configured; stub window manually.
    openSpy = vi.fn();
    if (typeof globalThis.window === "undefined") {
      Object.defineProperty(globalThis, "window", {
        value: { open: openSpy },
        configurable: true,
        writable: true,
      });
    } else {
      originalOpen = globalThis.window.open;
      globalThis.window.open = openSpy as unknown as typeof window.open;
    }
  });

  afterEach(() => {
    if (typeof globalThis.window !== "undefined" && originalOpen) {
      globalThis.window.open = originalOpen;
    }
  });

  it("opens wa.me with encoded share text (no raw spaces / colons in URL)", () => {
    const actions = pickActions({
      unresolvedItems: 0,
      recentUploads: [],
      activeProjectsCount: 0,
      shareUrl: "https://skitza.app/p/gili asraf",
    });
    const share = findCardOrThrow(actions, "share-link");
    if (!share.onClick) {
      throw new Error("share-link should expose an onClick handler");
    }
    share.onClick();
    expect(openSpy).toHaveBeenCalledTimes(1);
    const firstCall = openSpy.mock.calls[0];
    if (!firstCall) throw new Error("expected window.open to be called once");
    const [url, target, features] = firstCall as [string, string, string];
    expect(target).toBe("_blank");
    expect(features).toBe("noopener,noreferrer");
    // The text param must be encoded — raw "Check out my studio:"
    // would have a space and a colon, both of which encodeURIComponent
    // turns into %20 and %3A.
    expect(url).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(url).toContain("Check%20out%20my%20studio");
    // The whitespace inside the URL must also be encoded — no raw " ".
    const queryString = url.slice("https://wa.me/?text=".length);
    expect(queryString).not.toContain(" ");
    // Decode round-trip recovers the original message.
    expect(decodeURIComponent(queryString)).toBe(
      "Check out my studio: https://skitza.app/p/gili asraf",
    );
  });
});

// --- 3. Source-grep for JSX/style invariants --------------------

const here = dirname(fileURLToPath(import.meta.url));
const COMPONENT_PATH = join(here, "..", "contextual-actions.tsx");
const source = readFileSync(COMPONENT_PATH, "utf8");

describe("ContextualActions JSX — style matches PR #47 PrimaryButton", () => {
  it("card uses sk-lift for the hover lift", () => {
    expect(source).toContain("sk-lift");
  });

  it("card has the brand-primary inset bar on hover (LTR)", () => {
    expect(source).toContain("hover:shadow-[inset_3px_0_0_rgb(var(--brand-primary))]");
  });

  it("card flips the inset bar to the start edge in RTL", () => {
    expect(source).toContain("rtl:hover:shadow-[inset_-3px_0_0_rgb(var(--brand-primary))]");
  });

  it("card uses bg-elevated + subtle border (no hex codes)", () => {
    expect(source).toContain("bg-[rgb(var(--bg-elevated))]");
    expect(source).toContain("border-[rgb(var(--border-subtle))]");
  });

  it("card uses focus-visible ring on the brand-primary token", () => {
    expect(source).toContain("focus-visible:ring-[rgb(var(--brand-primary))]");
  });

  it("section is labeled for screen-readers", () => {
    expect(source).toMatch(/aria-label=["']Contextual actions["']/);
  });

  it("renders cards in a 1-col mobile / 3-col desktop grid", () => {
    expect(source).toContain("grid-cols-1");
    expect(source).toContain("sm:grid-cols-3");
  });
});

describe("ContextualActions — no hex codes / no framer-motion", () => {
  it("source has no #-hex color literal", () => {
    // CLAUDE.md style rule: CSS vars only. A 6-digit hex would be a
    // direct violation. Allow # only inside imports/comments — the
    // pattern below targets Tailwind class hex literals.
    expect(source).not.toMatch(/text-\[#[0-9a-fA-F]{3,6}\]/);
    expect(source).not.toMatch(/bg-\[#[0-9a-fA-F]{3,6}\]/);
  });

  it("source does not import framer-motion", () => {
    expect(source).not.toContain("framer-motion");
  });
});
