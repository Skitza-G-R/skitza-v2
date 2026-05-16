import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "client-card.tsx"), "utf-8");

describe("ClientCard source — avatar / link pill / stats / whole-card link", () => {
  it("exports a ClientCard component (function)", () => {
    expect(SRC).toMatch(/export function ClientCard/);
  });

  it("imports producerInitials + producerGradient (avatar system)", () => {
    expect(SRC).toContain("producerInitials");
    expect(SRC).toContain("producerGradient");
    expect(SRC).toContain("~/lib/_phase4-stubs/producer-color");
  });

  it("uses LinkPill for the link-state chip", () => {
    expect(SRC).toContain("LinkPill");
    expect(SRC).toContain("link-pill");
  });

  it("the whole card is the link target — single <Link> wraps everything", () => {
    expect(SRC).toContain('from "next/link"');
    // hrefs go to /dashboard/clients-projects/clients/<id>
    expect(SRC).toContain("/dashboard/clients-projects/clients/");
  });

  it("declares a ClientCardData with id + name + email + linkState + stats (projects/lifetime/owed)", () => {
    expect(SRC).toContain("ClientCardData");
    expect(SRC).toContain("name");
    expect(SRC).toContain("email");
    expect(SRC).toContain("linkState");
    expect(SRC).toContain("projects");
    expect(SRC).toContain("lifetime");
    expect(SRC).toContain("owed");
  });

  it("renders the 3 stat labels: Projects / Lifetime / Owed", () => {
    expect(SRC).toContain("Projects");
    expect(SRC).toContain("Lifetime");
    expect(SRC).toContain("Owed");
  });

  it("exposes drag callbacks so the parent can reorder cards", () => {
    expect(SRC).toContain("onDragStart");
    expect(SRC).toContain("onDragOver");
    expect(SRC).toContain("onDrop");
  });

  it("renders data-id={id} on the draggable wrapper for parent identification", () => {
    expect(SRC).toMatch(/data-id=\{[^}]*id[^}]*\}/);
  });

  it("uses bg-elevated for the card background", () => {
    expect(SRC).toContain("--bg-elevated");
  });

  it("uses border-subtle for the card border", () => {
    expect(SRC).toContain("--border-subtle");
  });

  it("uses fg-muted for the email line", () => {
    expect(SRC).toContain("--fg-muted");
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

  // ── Mockup-match motion polish (lift on hover, scale on press) ──
  it("lifts on hover via -translate-y (premium card feel)", () => {
    expect(SRC).toMatch(/hover:-translate-y-0\.5/);
  });

  it("uses a custom cubic-bezier transition curve (not plain ease)", () => {
    expect(SRC).toMatch(/cubic-bezier\(0\.23,\s*1,\s*0\.32,\s*1\)/);
  });

  it("ships a soft layered shadow on hover (not a harsh shadow-md)", () => {
    // Two-stop diffuse shadow gives cinematic depth a single
    // shadow-md can't. Pinning the exact shape so future cleanup
    // doesn't quietly flatten the lift.
    expect(SRC).toMatch(/hover:shadow-\[0_10px_24px/);
  });

  it("provides press feedback (active:scale) for tactile interaction", () => {
    expect(SRC).toMatch(/active:scale-\[/);
  });

  it("respects prefers-reduced-motion via motion-reduce escape hatches", () => {
    expect(SRC).toMatch(/motion-reduce:hover:translate-y-0/);
  });

  it("renders the avatar tile as a circle (mockup-match, not rounded-md)", () => {
    // HTML mockup's .clicard uses circular avatars on the workspace
    // grid — the locked design's family of "round small profile, big
    // square hero" stays intact. Pinning so a future cleanup doesn't
    // quietly flip this back to rounded-[var(--radius-md)].
    expect(SRC).toMatch(
      /h-12\s+w-12[\s\S]{0,80}rounded-full|rounded-full[\s\S]{0,80}h-12\s+w-12/,
    );
    expect(SRC).not.toMatch(/h-12\s+w-12[\s\S]{0,40}rounded-\[var\(--radius-md\)\]/);
  });
});
