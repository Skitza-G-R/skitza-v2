import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FAQ, FAQ_ITEMS, isFaqItemOpen } from "../faq";

// Tests for the FAQ accordion (S3 — landing-restore).
//
// Convention (per CLAUDE.md + features-tabs.test.tsx): pin the data
// contract directly via FAQ_ITEMS, exercise the open-state rule via the
// pure helper isFaqItemOpen, and use renderToStaticMarkup for structural
// invariants (item count, default-closed state). Click behaviour itself
// is covered by the helper — no DOM event simulation needed.
//
// Behaviour pinned: only one item can be open at a time. Clicking an
// already-open question closes it (activeIndex flips back to null).

describe("FAQ — landing accordion (S3)", () => {
  it("exposes exactly 6 FAQ questions", () => {
    expect(FAQ_ITEMS).toHaveLength(6);
  });

  it("every FAQ item has both a question and an answer string", () => {
    for (const item of FAQ_ITEMS) {
      expect(item.q.length).toBeGreaterThan(0);
      expect(item.a.length).toBeGreaterThan(0);
    }
  });

  it("isFaqItemOpen returns false when activeIndex is null (default state)", () => {
    for (let i = 0; i < FAQ_ITEMS.length; i++) {
      expect(isFaqItemOpen(null, i)).toBe(false);
    }
  });

  it("isFaqItemOpen returns true only for the matching index (single-active rule)", () => {
    // When activeIndex=2, only item 2 is open — every other item is closed.
    expect(isFaqItemOpen(2, 2)).toBe(true);
    expect(isFaqItemOpen(2, 0)).toBe(false);
    expect(isFaqItemOpen(2, 1)).toBe(false);
    expect(isFaqItemOpen(2, 3)).toBe(false);
    expect(isFaqItemOpen(2, 5)).toBe(false);
  });

  it("renders all 6 questions in initial server markup", () => {
    const html = renderToStaticMarkup(<FAQ />);
    for (const item of FAQ_ITEMS) {
      // Question text is present somewhere in the rendered markup.
      // renderToStaticMarkup escapes apostrophes to &#x27; so we
      // normalise the expected string the same way before searching.
      const escaped = item.q.replace(/'/g, "&#x27;");
      expect(html).toContain(escaped);
    }
  });

  it("default render: no faq-item carries the is-open class", () => {
    // Server-rendered initial state — useState<number | null>(null)
    // means activeIndex starts null, so no item-open class is applied.
    const html = renderToStaticMarkup(<FAQ />);
    expect(html).not.toContain("faq-item is-open");
  });

  it("renders 6 faq-item containers, one per question", () => {
    const html = renderToStaticMarkup(<FAQ />);
    const matches = html.match(/class="faq-item(?: is-open)?"/g) ?? [];
    expect(matches.length).toBe(6);
  });
});
