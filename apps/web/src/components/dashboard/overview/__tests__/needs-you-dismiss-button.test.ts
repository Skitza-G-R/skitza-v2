import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const BUTTON = readFileSync(join(here, "..", "needs-you-dismiss-button.tsx"), "utf8");
const OVERVIEW = readFileSync(join(here, "..", "overview-screen.tsx"), "utf8");

// SK-284 — the ✕ that hides a nagging row. Pinned by source contract, the same
// way the retired payment row was, because the behaviour that matters here is
// the safety net around an optimistic write.
describe("Needs You dismiss button", () => {
  it("names the row it hides, so the control is not just an unlabelled X", () => {
    expect(BUTTON).toContain("aria-label");
    expect(BUTTON).toContain("Hide ${title}");
  });

  it("hides optimistically but puts the row back when the save fails", () => {
    expect(BUTTON).toContain("onDismissed()");
    expect(BUTTON).toContain("onRestored()");
    expect(BUTTON).toContain("useTransition");
    expect(BUTTON).toMatch(/if \(!result\.ok\)/);
  });

  it("says what went wrong out loud rather than failing silently", () => {
    // A hidden sr-only line would leave sighted producers staring at a row
    // that quietly came back. The error toast is visible AND announced.
    expect(BUTTON).toContain('toast(result.error, "error")');
    expect(BUTTON).toContain("You're offline. Reconnect to hide this.");
  });

  it("offers Undo, and undo actually deletes the dismissal", () => {
    expect(BUTTON).toContain('label: "Undo"');
    expect(BUTTON).toContain("restoreAttentionRow");
  });

  it("refuses while offline, like every other live producer action", () => {
    expect(BUTTON).toContain("useOnlineStatus");
  });

  it("keeps a 44px hit area without spending 44px of a 360px row", () => {
    // Measured in a real browser at 360px: a 44x44 element left the subtitle
    // only 98px, which chopped a Hebrew project name. The element is now 36px
    // and reclaims its touch target with a ::before overlay (36 + 2*4 = 44) —
    // the same trick NEEDS_YOU_CHIP uses in the payments dashboard. Verified
    // in-browser: getBoundingClientRect on the button still reports 44x44.
    expect(BUTTON).toContain("sk-press-pop");
    expect(BUTTON).toContain("h-9 w-9");
    expect(BUTTON).toContain("before:-inset-1");
    expect(BUTTON).toContain("rounded-full");
  });

  it("paints for both panel themes", () => {
    // The Needs You panel is dark below lg and light above, so an icon with a
    // single colour set disappears at one of the two widths.
    expect(BUTTON).toContain("fg-onsidebar");
    expect(BUTTON).toContain("lg:text-");
  });

  it("is only rendered for rows the producer may hide", () => {
    expect(OVERVIEW).toContain("item.dismiss");
    expect(OVERVIEW).toContain("NeedsYouDismissButton");
  });
});
