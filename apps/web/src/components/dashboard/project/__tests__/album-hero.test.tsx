import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "album-hero.tsx"), "utf-8");

describe("AlbumHero — dark gradient band for the album page", () => {
  it("exports an AlbumHero component (function)", () => {
    expect(SRC).toMatch(/export function AlbumHero/);
  });

  it("imports deriveGradient + heroBg for the dark gradient band", () => {
    expect(SRC).toContain("deriveGradient");
    expect(SRC).toContain("heroBg");
    expect(SRC).toContain("~/lib/clients/derive-gradient");
    expect(SRC).toContain("~/lib/clients/hero-bg");
  });

  it("imports producerInitials + producerGradient for the 112px project avatar", () => {
    expect(SRC).toContain("producerInitials");
    expect(SRC).toContain("producerGradient");
    expect(SRC).toContain("~/lib/_phase4-stubs/producer-color");
  });

  it("uses HeroCTA for both Play latest + Add song actions", () => {
    expect(SRC).toContain("HeroCTA");
    expect(SRC).toContain("~/components/dashboard/common/hero-cta");
    expect(SRC).toMatch(/variant=["']play["']/);
    expect(SRC).toMatch(/variant=["']upload["']/);
  });

  it("uses the avatar size 112px (h-28 w-28)", () => {
    expect(SRC).toMatch(/h-28\b.*w-28|w-28\b.*h-28/);
  });

  it("renders the eyebrow PROJECT in uppercase", () => {
    // The eyebrow line is `PROJECT · <STAGE>` — assert PROJECT appears
    // inside the rendered string content (not just a comment).
    expect(SRC).toMatch(/>\s*PROJECT\b/);
  });

  it("renders the stage label uppercased in the eyebrow row", () => {
    expect(SRC).toContain("stageLabel");
    expect(SRC).toContain("~/lib/clients/workflow-stage");
    expect(SRC).toMatch(/toUpperCase\(\)/);
  });

  it("renders the project title in an h1 with the font-syne family", () => {
    expect(SRC).toMatch(/<h1[^>]*font-syne/);
  });

  it("renders the meta line: client · songs · sessions · total fee", () => {
    expect(SRC).toContain("clientName");
    expect(SRC).toContain("songsCount");
    expect(SRC).toContain("sessionsCount");
    expect(SRC).toContain("totalCents");
  });

  it("renders the 'Play latest' label on the play HeroCTA", () => {
    expect(SRC).toMatch(/Play\s*latest/);
  });

  it("renders the 'Add song' label on the upload HeroCTA", () => {
    expect(SRC).toMatch(/Add\s*song/);
  });

  it("places the dark hero background via inline style with heroBg(token)", () => {
    expect(SRC).toMatch(/style=\{\{[^}]*background:[^}]*heroBg/);
  });

  it("exposes onPlayLatest + onAddSong callbacks", () => {
    expect(SRC).toContain("onPlayLatest");
    expect(SRC).toContain("onAddSong");
  });

  it("forbids --surface-card", () => {
    expect(SRC).not.toContain("--surface-card");
  });

  it("forbids --text-muted", () => {
    expect(SRC).not.toContain("--text-muted");
  });

  it("forbids --text-strong", () => {
    expect(SRC).not.toContain("--text-strong");
  });

  it("forbids --surface-hover", () => {
    expect(SRC).not.toContain("--surface-hover");
  });

  it("forbids --brand-primary-on", () => {
    expect(SRC).not.toContain("--brand-primary-on");
  });

  it("renders hero CTAs as disabled when no handler is wired (no silent no-op)", () => {
    // Both Play latest + Add song fall through to <HeroCTA ... disabled>
    // when the parent doesn't pass a handler. We assert the disabled prop
    // is propagated on the no-handler branch of each ternary.
    expect(SRC).toMatch(/HeroCTA[^>]*variant=["']play["'][^>]*disabled/);
    expect(SRC).toMatch(/HeroCTA[^>]*variant=["']upload["'][^>]*disabled/);
  });
});
