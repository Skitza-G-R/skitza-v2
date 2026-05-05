import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildShareUrl,
  buildDisplayUrl,
  chipMode,
  type ChipMode,
} from "../sidebar-share-chip";

// Story 05 — SidebarShareChip tests.
//
// Repo convention (CLAUDE.md → testing): vitest runs in `node` env,
// no jsdom, no @testing-library/react. Mirrors Story 02 / 03 / 04
// pattern: pure helper unit tests + source-grep on the JSX shell.
//
// Render modes the algorithm guarantees:
//   - "expanded-with-slug"   — chip + copy button + opens-in-tab link
//   - "expanded-no-slug"     — "Set your slug →" CTA to settings
//   - "collapsed-with-slug"  — icon-only copy button (title=URL)
//   - "collapsed-no-slug"    — icon-only gear button to settings
//
// `buildShareUrl` strips trailing slash from the base URL so we never
// emit "skitza.app//join/alice".
// `buildDisplayUrl` drops the scheme — producers think of this as
// "skitza.app/join/alice", not a full URL.

const here = dirname(fileURLToPath(import.meta.url));
const COMPONENT_PATH = join(here, "..", "sidebar-share-chip.tsx");
// Phase 2 — the producer sidebar visual implementation moved to
// `~/components/nav/producer-sidebar.tsx`. The legacy
// `~/components/shell/sidebar.tsx` is now a thin re-export shim, so
// the integration grep needs to read the new location to see the
// chip mount, the publicBaseUrl threading, and the absence of the
// legacy `t("publicProfile")` link.
const SIDEBAR_PATH = join(here, "..", "..", "nav", "producer-sidebar.tsx");
const componentSource = readFileSync(COMPONENT_PATH, "utf8");
const sidebarSource = readFileSync(SIDEBAR_PATH, "utf8");

// ─── buildShareUrl ───────────────────────────────────────────────────

describe("buildShareUrl", () => {
  it("joins the base URL + /join/<slug>", () => {
    expect(buildShareUrl("https://skitza.app", "alice")).toBe(
      "https://skitza.app/join/alice",
    );
  });

  it("strips a trailing slash on the base URL (no double-slash)", () => {
    expect(buildShareUrl("https://skitza.app/", "alice")).toBe(
      "https://skitza.app/join/alice",
    );
  });

  it("works with a Vercel preview origin", () => {
    expect(
      buildShareUrl("https://skitza-git-feat-today.vercel.app", "bob"),
    ).toBe("https://skitza-git-feat-today.vercel.app/join/bob");
  });
});

// ─── buildDisplayUrl ────────────────────────────────────────────────

describe("buildDisplayUrl", () => {
  it("returns 'skitza.app/join/<slug>' (canonical short form)", () => {
    expect(buildDisplayUrl("alice")).toBe("skitza.app/join/alice");
  });

  it("returns the same shape for any slug — display copy is canonical", () => {
    expect(buildDisplayUrl("gili-asraf")).toBe("skitza.app/join/gili-asraf");
  });
});

// ─── chipMode — picks one of 4 render variants ──────────────────────

describe("chipMode", () => {
  it("expanded + slug → 'expanded-with-slug'", () => {
    expect(chipMode({ producerSlug: "alice", collapsed: false })).toBe<ChipMode>(
      "expanded-with-slug",
    );
  });

  it("expanded + null slug → 'expanded-no-slug'", () => {
    expect(chipMode({ producerSlug: null, collapsed: false })).toBe<ChipMode>(
      "expanded-no-slug",
    );
  });

  it("collapsed + slug → 'collapsed-with-slug'", () => {
    expect(chipMode({ producerSlug: "alice", collapsed: true })).toBe<ChipMode>(
      "collapsed-with-slug",
    );
  });

  it("collapsed + null slug → 'collapsed-no-slug'", () => {
    expect(chipMode({ producerSlug: null, collapsed: true })).toBe<ChipMode>(
      "collapsed-no-slug",
    );
  });

  it("treats empty-string slug as 'no slug' (defensive)", () => {
    // A producer with `slug = ""` is not a configured slug. Treat
    // identically to null so we don't render `/join/` with no path.
    expect(chipMode({ producerSlug: "", collapsed: false })).toBe<ChipMode>(
      "expanded-no-slug",
    );
    expect(chipMode({ producerSlug: "", collapsed: true })).toBe<ChipMode>(
      "collapsed-no-slug",
    );
  });
});

// ─── Source-grep — JSX shell invariants ─────────────────────────────

describe("SidebarShareChip — render variants in source", () => {
  it("renders the canonical 'skitza.app/join/' display prefix", () => {
    expect(componentSource).toContain("skitza.app/join/");
  });

  it("renders the 'Set your slug →' missing-slug CTA copy", () => {
    expect(componentSource).toContain("Set your slug");
  });

  it("missing-slug CTA links to /dashboard/settings?section=profile", () => {
    expect(componentSource).toContain(
      "/dashboard/settings?section=profile",
    );
  });

  it("collapsed gear icon also points to /dashboard/settings?section=profile", () => {
    // Both the expanded-no-slug link AND the collapsed-no-slug button
    // resolve to the same settings deep-link. Single string match is
    // sufficient — the source contains exactly one settings href.
    expect(componentSource).toContain('href="/dashboard/settings?section=profile"');
  });
});

describe("SidebarShareChip — copy button affordances", () => {
  it("calls navigator.clipboard.writeText (clipboard write path)", () => {
    expect(componentSource).toContain("navigator.clipboard.writeText");
  });

  it("uses the existing today.toasts namespace (copied + couldNotCopy keys)", () => {
    expect(componentSource).toContain("today.toasts");
    // Confirm the two specific keys we reuse from the existing
    // ShareLinkCard so a future refactor doesn't silently fork.
    expect(componentSource).toContain("copied");
    expect(componentSource).toContain("couldNotCopy");
  });

  it("aria-label on the copy button (a11y for icon-only control)", () => {
    expect(componentSource).toMatch(/aria-label=/);
  });

  it("title attribute on collapsed icon button (native hover tooltip = URL)", () => {
    // The collapsed icon-only button needs the URL on hover so users
    // know what they'd copy. The expanded chip body link also carries
    // a title for the same reason.
    expect(componentSource).toContain("title=");
  });
});

describe("SidebarShareChip — open-in-new-tab behavior", () => {
  it("expanded-with-slug chip body opens in a new tab (target=_blank)", () => {
    expect(componentSource).toMatch(/target=["']_blank["']/);
  });

  it("uses rel='noreferrer noopener' on the new-tab link (security)", () => {
    // noopener prevents the new tab from accessing window.opener;
    // noreferrer prevents leaking the dashboard URL as Referer.
    expect(componentSource).toMatch(/rel=["']noreferrer noopener["']/);
  });
});

describe("SidebarShareChip — RTL discipline", () => {
  it("does not use ml-* / mr-* literal margins (use ms-*/me-* / mx-*)", () => {
    // CLAUDE.md RTL rule. Strip comments first.
    const codeOnly = componentSource
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(codeOnly).not.toMatch(/\bml-\d/);
    expect(codeOnly).not.toMatch(/\bmr-\d/);
  });

  it("does not use right-* / left-* literal positioning (use start-*/end-*)", () => {
    const codeOnly = componentSource
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(codeOnly).not.toMatch(/className=["`][^"`]*\bright-\d/);
    expect(codeOnly).not.toMatch(/className=["`][^"`]*\bleft-\d/);
  });
});

describe("SidebarShareChip — design tokens only (no hex)", () => {
  it("source has no #-hex color literal in classNames", () => {
    expect(componentSource).not.toMatch(/text-\[#[0-9a-fA-F]{3,6}\]/);
    expect(componentSource).not.toMatch(/bg-\[#[0-9a-fA-F]{3,6}\]/);
    expect(componentSource).not.toMatch(/border-\[#[0-9a-fA-F]{3,6}\]/);
  });

  it("does not import framer-motion (CSS primitives only)", () => {
    expect(componentSource).not.toMatch(/from\s+["']framer-motion["']/);
  });
});

describe("Sidebar integration — wires in the new chip", () => {
  it("imports SidebarShareChip in the producer sidebar", () => {
    expect(sidebarSource).toContain("SidebarShareChip");
    // Phase 2 — the chip is imported via the path alias in the new
    // `~/components/nav/producer-sidebar.tsx` (the legacy relative
    // `./sidebar-share-chip` import only ever existed inside the
    // co-located shell/sidebar.tsx, which is now a re-export shim).
    expect(sidebarSource).toMatch(
      /import\s*\{\s*SidebarShareChip\s*\}\s*from\s*["']~\/components\/shell\/sidebar-share-chip["']/,
    );
  });

  it("Sidebar accepts the new publicBaseUrl prop", () => {
    // Threaded from app-shell. Surface check on the type signature.
    expect(sidebarSource).toContain("publicBaseUrl");
  });

  it("does not render the legacy 'Public profile →' Link in the footer anymore", () => {
    // The chip replaces the prior /join/<slug> Link block. Strip
    // narrative comments first so prose mentions don't false-positive.
    const codeOnly = sidebarSource
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    // Specifically the t("publicProfile") render call disappears.
    expect(codeOnly).not.toMatch(/\{t\(["']publicProfile["']\)\}/);
  });
});

// ─── Behaviour — clipboard write fires on copy click ────────────────

// We can't render the JSX (no jsdom). Instead, we expose `triggerCopy`
// as a pure helper from the component that takes the URL + a toast
// callback + the navigator.clipboard handle, and we drive that
// helper directly. This pins the actual write path that runs in the
// browser (separate from source-grep, which only proves the literal
// is in source).

describe("SidebarShareChip triggerCopy behavior", () => {
  let triggerCopy: typeof import("../sidebar-share-chip").triggerCopy;

  beforeEach(async () => {
    const mod = await import("../sidebar-share-chip");
    triggerCopy = mod.triggerCopy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls clipboard.writeText with the full URL on success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const toast = vi.fn();
    await triggerCopy({
      url: "https://skitza.app/join/alice",
      writeText,
      toast,
      tCopied: "Copied",
      tCouldNotCopy: "Couldn't copy",
    });
    expect(writeText).toHaveBeenCalledWith("https://skitza.app/join/alice");
    expect(toast).toHaveBeenCalledWith("Copied", "success");
  });

  it("fires the error toast when clipboard.writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("boom"));
    const toast = vi.fn();
    await triggerCopy({
      url: "https://skitza.app/join/alice",
      writeText,
      toast,
      tCopied: "Copied",
      tCouldNotCopy: "Couldn't copy",
    });
    expect(toast).toHaveBeenCalledWith("Couldn't copy", "error");
  });

  it("no-ops when url is empty (defensive — empty slug should never reach here)", async () => {
    const writeText = vi.fn();
    const toast = vi.fn();
    await triggerCopy({
      url: "",
      writeText,
      toast,
      tCopied: "Copied",
      tCouldNotCopy: "Couldn't copy",
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
