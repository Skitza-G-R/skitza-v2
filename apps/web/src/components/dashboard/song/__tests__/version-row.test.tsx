import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "version-row.tsx"), "utf-8");

describe("VersionRow — Song Space version-history row", () => {
  it("exports a VersionRow component (function)", () => {
    expect(SRC).toMatch(/export function VersionRow/);
  });

  it("is a client component (wires playerPlay + useNowPlaying)", () => {
    expect(SRC).toMatch(/^["']use client["']/);
  });

  it("imports playerPlay + useNowPlaying from PersistentPlayer", () => {
    expect(SRC).toContain("playerPlay");
    expect(SRC).toContain("useNowPlaying");
    expect(SRC).toContain("~/components/audio/persistent-player");
  });

  it("uses the BUILD-NOTES §6.6 grid: 36px minmax(0,1fr) 48px 48px 56px 32px", () => {
    expect(SRC).toContain("36px minmax(0,1fr) 48px 48px 56px 32px");
  });

  it("imports producerGradient for the 36px cover tile", () => {
    expect(SRC).toContain("producerGradient");
    expect(SRC).toContain("~/lib/_phase4-stubs/producer-color");
  });

  it("derives isCurrent from useNowPlaying().trackId === version.id", () => {
    expect(SRC).toMatch(/trackId\s*===\s*version\.id/);
  });

  it("paints amber wash + 3px amber left bar when now-playing (current styling)", () => {
    // Whitespace-tolerant: amber wash uses --brand-primary rgb at 0.10
    // alpha, the left bar is a 3px-wide pseudo element using the
    // before:* Tailwind utility.
    expect(SRC).toContain("--brand-primary");
    expect(SRC).toMatch(/before:/);
  });

  it("builds a PlayerTrack {id, audioUrl, title, subtitle, durationMs}", () => {
    expect(SRC).toContain("id: version.id");
    expect(SRC).toContain("audioUrl: version.audioUrl");
    expect(SRC).toContain("title:");
    expect(SRC).toContain("subtitle:");
    expect(SRC).toContain("durationMs:");
  });

  it("uses songTitle + projectName to build the player subtitle", () => {
    expect(SRC).toContain("songTitle");
    expect(SRC).toContain("projectName");
    // subtitle template: `${projectName} · ${versionLabel}`
    expect(SRC).toMatch(/projectName[\s\S]{0,40}versionLabel|versionLabel[\s\S]{0,40}projectName/);
  });

  it("calls playerPlay(...) from a row-level click handler", () => {
    // The onClick may inline the call or hand off to a `handlePlay`
    // closure — either way, playerPlay must be invoked from the row's
    // click path.
    expect(SRC).toMatch(/playerPlay\(\s*\{/);
    expect(SRC).toMatch(/onClick=\{[^}]+\}/);
  });

  it("renders the version label in mono with no chip background", () => {
    // Version tag is mono text — NOT a chip with border/background.
    expect(SRC).toMatch(/font-mono/);
    expect(SRC).toContain("versionLabel");
  });

  it("renders the duration in mono mm:ss (tabular-nums for alignment)", () => {
    expect(SRC).toMatch(/tabular-nums/);
  });

  it("renders the comment count using MessageSquare + noteCount", () => {
    expect(SRC).toContain("noteCount");
    // Either MessageSquare (lucide) or the literal '💬' emoji is fine —
    // either signals the chat bubble + count column.
    expect(SRC).toMatch(/MessageSquare|💬/);
  });

  it("renders the meta line: uploadedBy · when · changelog", () => {
    expect(SRC).toContain("uploadedBy");
    expect(SRC).toMatch(/uploadedAtIso|when|relative/);
    expect(SRC).toContain("changelog");
  });

  it("renders a play button column (rounded square) with amber tint when current", () => {
    // The 6th cell is a 32px rounded button. When current, the button
    // background reads from --brand-primary.
    expect(SRC).toMatch(/<button[^>]*type=["']button["']/);
    expect(SRC).toMatch(/Play\b/);
  });

  it("guards handlePlay when audioUrl is null", () => {
    expect(SRC).toMatch(/version\.audioUrl\s*===\s*null/);
  });

  it("sets aria-disabled / 'No audio available' for null-audio rows", () => {
    expect(SRC).toMatch(/aria-disabled/);
    expect(SRC).toMatch(/No audio available/);
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
});
