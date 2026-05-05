import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Phase C shipped five reusable motion primitives plus matching
// reduced-motion neutralisation. This test reads globals.css and
// asserts each class exists *and* has its @media guard — if someone
// adds a primitive but forgets the reduce gate (an accessibility
// regression), this catches it in CI rather than on the user.

const GLOBALS_CSS = readFileSync(
  fileURLToPath(new URL("../globals.css", import.meta.url)),
  "utf8",
);

// Landing page (S1, 2026-04-26) ports the founder's original CSS into
// apps/web/src/styles/landing.css. That file declares its own keyframes
// (drift, pulse-ambient, pulse-glow, fadeInSteam, float-mockup,
// float-mockup-alt, indicator-glow) and many `transition:` rules, so it
// also needs a `prefers-reduced-motion: reduce` neutralising block. The
// landing-specific assertions live further down in this file; we read
// the CSS once here.
const LANDING_CSS = readFileSync(
  fileURLToPath(new URL("../../styles/landing.css", import.meta.url)),
  "utf8",
);

// Extract the `@media (prefers-reduced-motion: reduce)` block so we
// can assert each primitive's neutralisation lives there specifically.
// Matches the last reduce block in the file (there may be more than
// one — we care about the motion-primitives one which is last).
function extractReduceBlock(): string {
  const blocks = [...GLOBALS_CSS.matchAll(
    /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n {2}\}/g,
  )];
  // Concatenate every reduce block so we catch selectors split across
  // multiple blocks (current file has three).
  return blocks.map((m) => m[1] ?? "").join("\n");
}

describe("Phase C motion primitives", () => {
  const reduceBlock = extractReduceBlock();

  it("defines .sk-lift with a :hover transform", () => {
    expect(GLOBALS_CSS).toMatch(/\.sk-lift\s*\{/);
    expect(GLOBALS_CSS).toMatch(/\.sk-lift:hover\s*\{[\s\S]*translateY\(-1px\)/);
  });

  it("defines .sk-pop and .sk-pop-center with pop-in keyframe", () => {
    expect(GLOBALS_CSS).toMatch(/\.sk-pop\s*\{/);
    expect(GLOBALS_CSS).toMatch(/\.sk-pop-center\s*\{/);
    expect(GLOBALS_CSS).toMatch(/@keyframes skitza-pop-in\b/);
  });

  it("defines .sk-cta-shine with a diagonal shine keyframe", () => {
    expect(GLOBALS_CSS).toMatch(/\.sk-cta-shine\s*\{/);
    expect(GLOBALS_CSS).toMatch(/@keyframes skitza-cta-shine\b/);
    expect(GLOBALS_CSS).toMatch(/\.sk-cta-shine:hover::after/);
  });

  it("defines .sk-pulse-hover wired to the existing pulse-glow keyframe", () => {
    expect(GLOBALS_CSS).toMatch(/\.sk-pulse-hover:hover\s*\{[\s\S]*skitza-pulse-glow/);
  });

  // Each Phase C primitive MUST have a reduce gate. Losing any of
  // these is an a11y regression — the test covers each one.
  it.each([
    ".sk-lift",
    ".sk-pop",
    ".sk-pop-center",
    ".sk-cta-shine",
    ".sk-pulse-hover",
  ])("respects prefers-reduced-motion for %s", (selector) => {
    expect(reduceBlock).toContain(selector);
  });
});

// Batch C added two motion primitives on top of the Phase C set:
//   - .sk-page-enter — route-level fade/slide
//   - .sk-stagger-item — per-row staggered reveal in lists
// Both need the same reduce-motion guard so a producer on reduced
// motion doesn't see the staggered in-animation on every list render.
describe("Batch C motion primitives", () => {
  const reduceBlock = extractReduceBlock();

  it("defines .sk-page-enter with a fade+slide keyframe", () => {
    expect(GLOBALS_CSS).toMatch(/\.sk-page-enter\s*\{/);
    expect(GLOBALS_CSS).toMatch(/@keyframes skitza-page-enter\b/);
  });

  it("defines .sk-stagger-item using --i for delay ordering", () => {
    expect(GLOBALS_CSS).toMatch(/\.sk-stagger-item\s*\{/);
    expect(GLOBALS_CSS).toMatch(/calc\(min\(var\(--i, 0\), 12\) \* 30ms\)/);
  });

  it.each([".sk-page-enter", ".sk-stagger-item"])(
    "respects prefers-reduced-motion for %s",
    (selector) => {
      expect(reduceBlock).toContain(selector);
    },
  );
});

// Phase 4 added the Sheet primitive (apps/web/src/components/ui/sheet.tsx)
// for bottom-anchored modals + side-anchored desktop drawers. The motion
// contract uses `.sk-sheet-enter` with a `data-side` attribute to pick
// the right keyframe per side. Reduce-motion gating is non-negotiable —
// any future side variant added here MUST also be added to the reduce
// block in globals.css.
describe("Phase 4 Sheet primitive motion", () => {
  const reduceBlock = extractReduceBlock();

  it("declares .sk-sheet-enter[data-side='bottom'] using the existing slide-up keyframe", () => {
    expect(GLOBALS_CSS).toMatch(
      /\.sk-sheet-enter\[data-side="bottom"\][\s\S]*?animation:\s*skitza-slide-up-modal/,
    );
  });

  it("declares .sk-sheet-enter[data-side='right'] using a slide-in-right keyframe", () => {
    expect(GLOBALS_CSS).toMatch(/@keyframes skitza-slide-in-right\b/);
    expect(GLOBALS_CSS).toMatch(
      /\.sk-sheet-enter\[data-side="right"\][\s\S]*?animation:\s*skitza-slide-in-right/,
    );
  });

  it("respects prefers-reduced-motion for .sk-sheet-enter", () => {
    expect(reduceBlock).toContain(".sk-sheet-enter");
  });
});

// Landing CSS (Phase 3 v3) is a slim companion to globals.css —
// the v3 landing leans almost entirely on token-bound Tailwind
// arbitrary values + the motion primitives in globals.css. The only
// landing-only motion is the hero word-fade (`.hero-word`), so the
// landing.css reduce-motion block needs to neutralise that one
// scoped selector. Every other reveal/animation primitive used by the
// landing (`.sk-reveal*`, `.sk-soft-pulse`, `.sk-float`, `sk-pop`,
// `animate-shine`, etc.) lives in globals.css and is covered by the
// reduce-motion blocks asserted above.
//
// This test pins the v3 landing.css contract:
//   - At least one @media (prefers-reduced-motion: reduce) block.
//   - The `.hero-word` rule is forced visible inside that block (so
//     reduce-motion visitors see the hero copy with no fade-in).
//
// The previous PR #50 contract (`.landing-root *` catch-all +
// `.reveal-up`) was retired in Phase 3 — see
// docs/qa/phase-3-handoff.md.
describe("Landing CSS reduce-motion gate (Phase 3 v3)", () => {
  function extractLandingReduceBlock(): string {
    const blocks = [...LANDING_CSS.matchAll(
      /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g,
    )];
    return blocks.map((m) => m[1] ?? "").join("\n");
  }

  it("declares at least one @media (prefers-reduced-motion: reduce) block", () => {
    expect(LANDING_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("neutralises the hero word-fade for reduced-motion visitors", () => {
    const reduce = extractLandingReduceBlock();
    // .hero-word starts at opacity:0 + transform:translateY(0.4em) and
    // becomes visible when the parent gets `.is-loaded`. Under reduce,
    // that transition is skipped — the reduce gate must force the
    // revealed state immediately so visitors don't see a flash of
    // hidden hero text.
    expect(reduce).toMatch(/\.hero-word/);
    expect(reduce).toMatch(/opacity:\s*1\s*!important/);
    expect(reduce).toMatch(/transform:\s*none\s*!important/);
    expect(reduce).toMatch(/transition:\s*none\s*!important/);
  });

  it("globals.css carries the reduce-motion gates for sk-reveal*, sk-soft-pulse, and sk-float", () => {
    // The v3 landing reveal pattern (`.sk-reveal`, `.sk-reveal-left`,
    // `.sk-reveal-right`, `.sk-reveal-scale`) plus the ambient
    // `.sk-soft-pulse` / `.sk-float` / `.sk-float-slow` keyframes live
    // in globals.css alongside the rest of the design system. Their
    // reduce-motion neutralisation MUST live in the same file so the
    // motion-primitives.test invariant ("each primitive has a reduce
    // gate") holds across the whole stylesheet.
    const reduce = extractReduceBlock();
    expect(reduce).toContain(".sk-reveal");
    expect(reduce).toContain(".sk-reveal-left");
    expect(reduce).toContain(".sk-reveal-right");
    expect(reduce).toContain(".sk-reveal-scale");
    expect(reduce).toContain(".sk-soft-pulse");
    expect(reduce).toContain(".sk-float");
    expect(reduce).toContain(".sk-float-slow");
  });
});
