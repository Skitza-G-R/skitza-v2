import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  EMPTY_SHELF_RESULT,
  shelfRenderModel,
  cardHref,
  cardPlayDetail,
  badgeText,
} from "../recent-uploads-shelf";
import type { RecentUpload } from "../../../../server/trpc/routers/producer";

// Source-grep + pure-helper test for the RecentUploadsShelf surface.
// Following the repo convention (CLAUDE.md → testing): no React
// Testing Library (vitest runs in node env), so we pin:
//   1. the rendering decision via a pure render-model helper
//      (`shelfRenderModel`) the component consumes,
//   2. the click-target href + custom-event payload via tiny pure
//      helpers (`cardHref`, `cardPlayDetail`, `badgeText`),
//   3. the static markup pieces (eyebrow, heading, View-all link,
//      ARIA attributes, RTL-aware classes) via reading the source.
//
// This catches regressions of the form "someone refactored the
// component and accidentally hardcoded right-1 instead of -end-1" or
// "someone changed the deep-link route shape and forgot ?tab=music".

const here = dirname(fileURLToPath(import.meta.url));
const SHELF_PATH = join(here, "..", "recent-uploads-shelf.tsx");
const CARD_PATH = join(here, "..", "recent-upload-card.tsx");
const shelfSrc = readFileSync(SHELF_PATH, "utf8");
const cardSrc = readFileSync(CARD_PATH, "utf8");

function makeUpload(over: Partial<RecentUpload> = {}): RecentUpload {
  return {
    versionId: "v-1",
    trackId: "t-1",
    title: "Sunset Mix",
    versionLabel: "v3",
    uploadedAt: new Date("2026-04-25T12:00:00Z"),
    audioUrl: "https://r2/audio/v-1.mp3",
    durationMs: 180_000,
    projectId: "p-1",
    projectClientName: "Bob",
    projectStage: "in_production",
    unreadComments: 0,
    ...over,
  };
}

describe("RecentUploadsShelf shelfRenderModel — empty / sparse / full", () => {
  it("returns null-shape EMPTY_SHELF_RESULT for 0 uploads (component returns null)", () => {
    const m = shelfRenderModel([]);
    expect(m).toEqual(EMPTY_SHELF_RESULT);
    expect(m.render).toBe(false);
  });

  it("renders 1 card for a single upload (sparse, no scroll affordance)", () => {
    const m = shelfRenderModel([makeUpload({ versionId: "v-a" })]);
    expect(m.render).toBe(true);
    expect(m.visibleCards.map((u) => u.versionId)).toEqual(["v-a"]);
    expect(m.showViewAll).toBe(false);
  });

  it("renders 4 cards for sparse state (no View-all link)", () => {
    const ids = ["v1", "v2", "v3", "v4"];
    const m = shelfRenderModel(ids.map((id) => makeUpload({ versionId: id })));
    expect(m.render).toBe(true);
    expect(m.visibleCards.map((u) => u.versionId)).toEqual(ids);
    expect(m.showViewAll).toBe(false);
  });

  it("renders the first 5 cards for 7 uploads + adds View-all link", () => {
    const ids = ["v1", "v2", "v3", "v4", "v5", "v6", "v7"];
    const m = shelfRenderModel(ids.map((id) => makeUpload({ versionId: id })));
    expect(m.render).toBe(true);
    expect(m.visibleCards.map((u) => u.versionId)).toEqual([
      "v1",
      "v2",
      "v3",
      "v4",
      "v5",
    ]);
    expect(m.showViewAll).toBe(true);
  });

  it("at exactly 5 uploads, no View-all link (first 5 already visible)", () => {
    const ids = ["v1", "v2", "v3", "v4", "v5"];
    const m = shelfRenderModel(ids.map((id) => makeUpload({ versionId: id })));
    expect(m.showViewAll).toBe(false);
    expect(m.visibleCards).toHaveLength(5);
  });
});

describe("RecentUploadsShelf cardHref — deep-link to project room music tab", () => {
  it("targets /dashboard/projects/<projectId>?tab=music&versionId=<versionId>", () => {
    const u = makeUpload({ projectId: "p-77", versionId: "v-99" });
    expect(cardHref(u)).toBe("/dashboard/projects/p-77?tab=music&versionId=v-99");
  });
});

describe("RecentUploadsShelf cardPlayDetail — custom-event payload", () => {
  it("includes versionId, audioUrl, durationMs, title, subtitle from project + version", () => {
    const u = makeUpload({
      versionId: "v-42",
      audioUrl: "https://r2/x.mp3",
      durationMs: 200_000,
      title: "Sunset Mix",
      versionLabel: "v3",
      projectClientName: "Bob's EP",
    });
    const d = cardPlayDetail(u);
    // The detail payload MUST carry these fields — the persistent
    // player needs them to render its title/subtitle ticker. We
    // expose `id` so the player keys its <audio> element by it.
    expect(d).toEqual({
      id: "v-42",
      audioUrl: "https://r2/x.mp3",
      title: "Sunset Mix",
      subtitle: "Bob's EP · v3",
      durationMs: 200_000,
    });
  });
});

describe("RecentUploadsShelf badgeText — unread-comments cap", () => {
  it("returns null for 0", () => {
    expect(badgeText(0)).toBeNull();
  });

  it("returns the digit string for 1..99", () => {
    expect(badgeText(1)).toBe("1");
    expect(badgeText(9)).toBe("9");
    expect(badgeText(99)).toBe("99");
  });

  it('caps to "99+" for 100+', () => {
    expect(badgeText(100)).toBe("99+");
    expect(badgeText(9999)).toBe("99+");
  });

  it("returns null for negatives (defensive)", () => {
    expect(badgeText(-1)).toBeNull();
  });
});

describe("RecentUploadsShelf source — eyebrow + heading + View-all link copy", () => {
  it("renders the eyebrow 'Studio · Recent uploads'", () => {
    expect(shelfSrc).toContain("Studio · Recent uploads");
  });

  it("renders the heading 'Recent uploads'", () => {
    expect(shelfSrc).toMatch(/>\s*Recent uploads\s*</);
  });

  it("renders 'View all in Music →' link to /dashboard/music", () => {
    expect(shelfSrc).toContain("View all in Music");
    expect(shelfSrc).toContain('href="/dashboard/music"');
  });

  it("uses sk-scroll-x utility on the horizontal rail (mobile momentum scroll)", () => {
    expect(shelfSrc).toContain("sk-scroll-x");
  });

  it("aria-labelledby='recent-uploads-heading' wires section to its heading id", () => {
    expect(shelfSrc).toContain('aria-labelledby="recent-uploads-heading"');
    expect(shelfSrc).toContain('id="recent-uploads-heading"');
  });

  it("data-tour-id='recent-uploads' is set for the coach-mark tour", () => {
    expect(shelfSrc).toContain('data-tour-id="recent-uploads"');
  });
});

describe("RecentUploadCard source — accessibility + RTL discipline", () => {
  it("uses logical -end-1 (not right-1) so the badge mirrors under RTL", () => {
    expect(cardSrc).toContain("-end-1");
    // Strip comments before checking — narrative comments may
    // mention `right-1` in prose explaining the pitfall.
    const codeOnly = cardSrc.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(codeOnly).not.toMatch(/className=["`][^"`]*\bright-1\b/);
  });

  it("the play-overlay button has a dynamic aria-label", () => {
    expect(cardSrc).toContain("aria-label=");
    expect(cardSrc).toMatch(/Play \$\{[^}]+\}/);
  });

  it("the unread-comments badge has its own aria-label", () => {
    expect(cardSrc).toMatch(/aria-label=\{`\$\{[^}]+\} unread comments`\}/);
  });

  it("dispatches the existing PersistentPlayer event 'skitza:player:set'", () => {
    // The architecture spec named the event 'skitza:play-version', but
    // the existing PersistentPlayer (apps/web/src/components/audio/
    // persistent-player.tsx) listens to 'skitza:player:set'. Match
    // what exists rather than invent a parallel listener — this is
    // the deviation captured in the final report.
    expect(cardSrc).toContain("skitza:player:set");
    expect(cardSrc).not.toContain("skitza:play-version");
  });

  it("the play-button calls preventDefault + stopPropagation so the link doesn't fire", () => {
    expect(cardSrc).toContain("preventDefault");
    expect(cardSrc).toContain("stopPropagation");
  });

  it("the cover wrapper carries role='img' aria-hidden via TrackCover", () => {
    // The card delegates the cover render to <TrackCover>; the role
    // and aria-hidden live in TrackCover. We just assert the card
    // imports + uses TrackCover.
    expect(cardSrc).toContain("TrackCover");
  });

  it("href deep-links via the cardHref helper (which builds /dashboard/projects/<id>?tab=music&versionId=<id>)", () => {
    // The card delegates URL construction to `cardHref`, which is
    // pinned in the cardHref test above. Just verify the card
    // imports + invokes it on the <a> href.
    expect(cardSrc).toContain("cardHref");
    expect(cardSrc).toMatch(/href=\{cardHref\(/);
  });
});

describe("TrackCover source — role + aria-hidden", () => {
  const TRACK_COVER_PATH = join(
    here,
    "..",
    "..",
    "..",
    "audio",
    "track-cover.tsx",
  );
  const trackCoverSrc = readFileSync(TRACK_COVER_PATH, "utf8");

  it('renders role="img" and aria-hidden so screen-readers skip the gradient', () => {
    expect(trackCoverSrc).toContain('role="img"');
    expect(trackCoverSrc).toContain("aria-hidden");
  });
});
