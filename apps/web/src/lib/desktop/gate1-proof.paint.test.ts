// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { hasGate1MeaningfulPaint } from "./gate1-proof";

const PAINTED_BOX = {
  bottom: 120,
  height: 100,
  left: 10,
  right: 210,
  top: 20,
  width: 200,
  x: 10,
  y: 20,
  toJSON: () => ({}),
};

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Gate 1 painted-screen evidence", () => {
  it("accepts a visible real title and visible metric", () => {
    document.body.innerHTML = `
      <main data-proof-root>
        <h1 data-gate1-meaningful-title>Clients &amp; Projects</h1>
        <div data-gate1-meaningful-item>4 projects</div>
      </main>
    `;
    const root = document.querySelector<HTMLElement>("[data-proof-root]");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(PAINTED_BOX);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => document.body,
    });
    expect(hasGate1MeaningfulPaint(root)).toBe(true);
  });

  it("rejects zero-sized content and a painted full-screen loading surface", () => {
    document.body.innerHTML = `
      <main data-proof-root>
        <h1>Today</h1>
        <div data-gate1-meaningful-item>2 active projects</div>
        <div aria-busy="true" data-blocker></div>
      </main>
    `;
    const root = document.querySelector<HTMLElement>("[data-proof-root]");
    expect(hasGate1MeaningfulPaint(root)).toBe(false);

    const blocker = document.querySelector<HTMLElement>("[data-blocker]");
    if (!blocker) throw new Error("Expected nested blocker");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this === blocker) {
        return {
          ...PAINTED_BOX,
          bottom: window.innerHeight,
          height: window.innerHeight,
          left: 0,
          right: window.innerWidth,
          top: 0,
          width: window.innerWidth,
          x: 0,
          y: 0,
        };
      }
      return PAINTED_BOX;
    });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => document.body,
    });
    expect(hasGate1MeaningfulPaint(root)).toBe(false);
  });
});
