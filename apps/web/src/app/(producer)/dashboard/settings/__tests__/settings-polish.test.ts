import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Settings page — second-pass polish (design-critique sweep 2026-05-15).
// Source-string assertions in the same style as settings-cleanup.test.ts —
// the codebase chose source-pattern tests over RTL renders (see toast.test.tsx).

const here = dirname(fileURLToPath(import.meta.url));
const SETTINGS_DIR = join(here, "..");
const css = readFileSync(join(SETTINGS_DIR, "settings.css"), "utf8");
const client = readFileSync(join(SETTINGS_DIR, "settings-client.tsx"), "utf8");

describe("Settings polish — reveal animation duration", () => {
  it("uses 0.22s reveal (was 0.45s — felt laggy when switching sections)", () => {
    // The cubic-bezier curve stays; only the duration shrinks. We
    // pin the duration string so a future tweak that drifts back to
    // the slow value fails this test loudly.
    expect(css).toMatch(/\.s-reveal\s*{[^}]*animation:\s*s-reveal 0\.22s cubic-bezier/);
  });
});

describe("Settings polish — reduced motion", () => {
  it("stops the savebar pulse as well as the section animations", () => {
    const reducedMotion = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/,
    )?.[1];

    expect(reducedMotion).toContain(".s-savebar-pulse::after");
    expect(reducedMotion).toContain("animation: none !important");
  });
});

describe("Settings polish — no fake usage numbers", () => {
  it("PlanFreeView does not hard-code fake artistsUsed or storageUsed", () => {
    // Wrong numbers cost trust permanently. Real usage measurement
    // lands in a separate task; until then, the cells show em-dash
    // placeholders and a soft 'Usage tracking soon' line. We pin the
    // *absence* of the old fake values so a future revert can't sneak
    // them back in.
    expect(client).not.toMatch(/const\s+artistsUsed\s*=\s*\d/);
    expect(client).not.toMatch(/const\s+storageUsed\s*=\s*[\d.]+\s*;/);
  });

  it("PlanProView does not hard-code fake artistsCount", () => {
    expect(client).not.toMatch(/const\s+artistsCount\s*=\s*\d/);
  });

  it("renders an em-dash placeholder for usage numbers", () => {
    // Em-dash is the conventional 'no data yet' glyph in this design
    // system (matches the Overview empty state pattern).
    expect(client).toMatch(/UsageCell[\s\S]{0,200}num=\{?["'`]—["'`]/);
  });
});

describe("Settings polish — per-section dirty dot in sub-nav", () => {
  it("computes a set of dirty section keys (not just a single boolean)", () => {
    // The original `dirty` boolean stays — it controls the savebar.
    // We add a per-section breakdown so the sub-nav can render a dot
    // on the row(s) that own unsaved fields.
    expect(client).toMatch(/dirtySections/);
  });

  it("sub-nav button renders an indicator when its section is dirty", () => {
    // The dot is a span (or similar) gated on the section appearing in
    // dirtySections. Pin the class name so a future style refactor
    // can't silently strip the affordance.
    expect(client).toMatch(/s-nav-dirty-dot/);
  });
});

describe("Settings polish — card integrations removed", () => {
  it("does not couple IntegrationsSection to currency", () => {
    const block = client.match(/function IntegrationsSection[\s\S]*?\n}\s*\n/)?.[0] ?? "";
    expect(block, "IntegrationsSection block not found").not.toBe("");
    expect(block).not.toMatch(/defaultCurrency/);
  });

  it("does not hide a removed secondary payment provider in a disclosure", () => {
    expect(client).not.toMatch(/<details\b/);
  });
});

describe("Settings polish — Profile shows public-page slug preview", () => {
  it("ProfileSection renders the producer's public-page URL", () => {
    // The Profile section used to be just Avatar + Display name. To a
    // producer who lands on Settings for the first time, that reads as
    // "missing fields" because their slug / brand / portfolio live on
    // a route that hasn't shipped yet (the future /dashboard/public-page).
    // Until that lands, we surface the producer's slug here so they can
    // see / copy their public-page URL without leaving Settings.
    const profile = client.match(/function ProfileSection[\s\S]*?\n}\s*\n/)?.[0] ?? "";
    expect(profile, "ProfileSection block not found").not.toBe("");
    expect(profile).toMatch(/\/join\//);
  });

  it("SettingsClient takes the producer's slug as a prop", () => {
    // Plumbing check — page.tsx must hand the slug down for the
    // preview row above to have anything to render. Match the props
    // type declaration loosely so re-ordering keys doesn't break us.
    expect(client).toMatch(/slug:\s*string/);
  });

  it("page.tsx passes profile.slug into SettingsClient", () => {
    const page = readFileSync(join(SETTINGS_DIR, "page.tsx"), "utf8");
    expect(page).toMatch(/slug:\s*profile\.slug/);
  });
});

describe("Settings polish — truthful browser notifications", () => {
  it("mounts real push preferences without the removed fake notification matrix", () => {
    const notif = client.match(/function NotifSection[\s\S]*?\n}\s*\n/)?.[0] ?? "";
    expect(notif, "NotifSection block not found").not.toBe("");
    expect(notif).toContain("Choose the real Skitza updates this browser can send you.");
    expect(notif).toContain("<PushPreferences />");
    expect(notif).not.toContain("Heads up");
    expect(notif).not.toContain("s-notif-head");
  });
});

describe("Settings polish — sub-nav click updates URL", () => {
  it("calls window.history.replaceState with the new ?section= key", () => {
    // We deliberately use the raw history API (not router.replace)
    // because Next App Router's router.replace would re-fetch the
    // server page and remount SettingsClient, wiping unsaved form
    // edits. The history API updates the URL bar silently — deep
    // links / browser back still work, in-flight edits survive.
    expect(client).toMatch(/window\.history\.replaceState[\s\S]{0,120}section=/);
  });
});

describe("Settings polish — dead Plan CTAs removed (Free view)", () => {
  it("PlanFreeView renders no ComingSoonButton", () => {
    // Pull the PlanFreeView function body out of the source. Previously
    // it had 3 buttons (Upgrade in the hero, See-what's-in-Pro in the
    // hero, Upgrade in the pricing card) — all toasting 'Coming soon'.
    // Producer hit the same fake toast three times. SK-99 removes
    // placeholder controls instead of leaving an unwired upgrade CTA.
    const block = client.match(/function PlanFreeView[\s\S]*?\n}\s*\n/)?.[0] ?? "";
    expect(block, "PlanFreeView block not found").not.toBe("");
    const ctas = block.match(/<ComingSoonButton\b/g) ?? [];
    expect(ctas).toHaveLength(0);
  });
});

describe("Settings polish — page title hierarchy", () => {
  it("rail H1 'Settings' is larger than section H2 (page > section)", () => {
    // Read both sizes out of the CSS and assert numerical ordering.
    // Pinning a specific size would be too rigid — the rule is
    // 'H1 > H2', not 'H1 == 34'. (Today: H2 is 30; H1 must exceed.)
    const h1Match = css.match(/\.s-nav\s+h1\s*{[^}]*font-size:\s*(\d+)px/);
    const h2Match = css.match(/\.s-section-head\s+h2\s*{[^}]*font-size:\s*(\d+)px/);
    expect(h1Match, "rail H1 font-size not found").not.toBeNull();
    expect(h2Match, "section H2 font-size not found").not.toBeNull();
    const h1px = Number.parseInt(h1Match?.[1] ?? "0", 10);
    const h2px = Number.parseInt(h2Match?.[1] ?? "0", 10);
    expect(h1px).toBeGreaterThan(h2px);
  });
});
