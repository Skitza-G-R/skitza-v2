import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Tests for RevealOnScroll (Phase 3 v3 landing — replaces the legacy
// `.landing-root .reveal-up` / `.is-revealed` pair from PR #50).
//
// The CSS rules `.sk-reveal { opacity: 0; transform: translateY(18px) }`
// (and the `-left`/`-right`/`-scale` variants) hide every reveal-bound
// element on the v3 landing by default. They're only meant to fade in
// when JS adds `.is-in`. Without the IntersectionObserver wired in,
// every element stays at opacity 0 forever — visitors saw a blank
// brown void below the hero (CLAUDE.md mistake-log 2026-04-26).
//
// In-repo testing convention is node-env vitest with no jsdom and no
// @testing-library/react. So instead of mounting the React component
// and waiting for useEffect to fire, we:
//   1. Stub globalThis.document with a minimal DOM (querySelectorAll +
//      classList.add) sufficient for the component's logic.
//   2. Stub globalThis.IntersectionObserver with a recorder that
//      captures the constructor args + observe/unobserve/disconnect
//      calls, and exposes the user-supplied callback so tests can
//      simulate intersection events.
//   3. Manually invoke the useEffect body by extracting it (the
//      component's effect-deps are []) — we render via React for the
//      "renders nothing" assertion, but for behaviour we run the
//      effect logic directly with our stubs in place.
//
// This mirrors the pattern other client-effect tests in the repo use
// (e.g. lib/keyboard tests stub document.addEventListener directly
// rather than spinning up jsdom).

type ObserverCallback = (
  entries: Array<{ isIntersecting: boolean; target: Element }>,
  observer: IntersectionObserver,
) => void;

interface RecorderObserver {
  callback: ObserverCallback;
  options: IntersectionObserverInit | undefined;
  observed: Element[];
  unobserved: Element[];
  disconnected: boolean;
  observe(el: Element): void;
  unobserve(el: Element): void;
  disconnect(): void;
}

interface FakeElement {
  id: string;
  classList: { add: (cls: string) => void; has: (cls: string) => boolean };
  _classes: Set<string>;
}

function makeFakeElement(id: string): FakeElement {
  const classes = new Set<string>();
  return {
    id,
    _classes: classes,
    classList: {
      add: (cls: string) => {
        classes.add(cls);
      },
      has: (cls: string) => classes.has(cls),
    },
  };
}

let recorders: RecorderObserver[] = [];
let fakeMatches: FakeElement[] = [];
let lastSelector: string | null = null;

const originalDocument = (globalThis as { document?: unknown }).document;
const originalIO = (globalThis as { IntersectionObserver?: unknown })
  .IntersectionObserver;
const originalWindow = (globalThis as { window?: unknown }).window;

function installDocumentStub(matches: FakeElement[]): void {
  fakeMatches = matches;
  lastSelector = null;
  (globalThis as { document?: unknown }).document = {
    querySelectorAll: (selector: string) => {
      lastSelector = selector;
      return fakeMatches;
    },
  };
}

function installObserverStub(): void {
  recorders = [];
  class StubIO {
    callback: ObserverCallback;
    options: IntersectionObserverInit | undefined;
    observed: Element[] = [];
    unobserved: Element[] = [];
    disconnected = false;
    constructor(cb: ObserverCallback, options?: IntersectionObserverInit) {
      this.callback = cb;
      this.options = options;
      recorders.push(this as unknown as RecorderObserver);
    }
    observe(el: Element) {
      this.observed.push(el);
    }
    unobserve(el: Element) {
      this.unobserved.push(el);
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    StubIO;
  // window.IntersectionObserver is what the component actually reads
  // via the bare `IntersectionObserver` reference, which resolves
  // through globalThis. Some React internals also check window — keep
  // both in sync.
  (globalThis as { window?: { IntersectionObserver?: unknown } }).window = {
    IntersectionObserver: StubIO,
  };
}

function removeObserverStub(): void {
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  delete (globalThis as { window?: unknown }).window;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (originalDocument === undefined) {
    delete (globalThis as { document?: unknown }).document;
  } else {
    (globalThis as { document?: unknown }).document = originalDocument;
  }
  if (originalIO === undefined) {
    delete (globalThis as { IntersectionObserver?: unknown })
      .IntersectionObserver;
  } else {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      originalIO;
  }
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
  recorders = [];
  fakeMatches = [];
  lastSelector = null;
});

describe("RevealOnScroll — v3 IntersectionObserver wiring", () => {
  it("renders nothing (returns null — pure behaviour component)", async () => {
    const { RevealOnScroll } = await import("../reveal-on-scroll");
    const html = renderToStaticMarkup(<RevealOnScroll />);
    expect(html).toBe("");
  });

  it("queries the v3 reveal selector union (sk-reveal + variants)", async () => {
    installDocumentStub([makeFakeElement("a")]);
    installObserverStub();

    const { runRevealEffect } = await import("../reveal-on-scroll");
    const cleanup = runRevealEffect();

    expect(lastSelector).toBe(
      ".sk-reveal, .sk-reveal-left, .sk-reveal-right, .sk-reveal-scale",
    );

    cleanup?.();
  });

  it("constructs an IntersectionObserver with the v3 rootMargin + threshold", async () => {
    installDocumentStub([makeFakeElement("a")]);
    installObserverStub();

    const { runRevealEffect } = await import("../reveal-on-scroll");
    const cleanup = runRevealEffect();

    expect(recorders).toHaveLength(1);
    const recorder = recorders[0];
    if (!recorder) throw new Error("expected one recorder");
    // The v3 design fires the reveal slightly before the element fully
    // enters the viewport (`-8%` rootMargin) so a section reveals as
    // its top crosses the fold, not after — feels more responsive on
    // long scrolls.
    expect(recorder.options).toEqual({
      root: null,
      rootMargin: "0px 0px -8% 0px",
      threshold: 0.08,
    });

    cleanup?.();
  });

  it("observes every reveal element returned by querySelectorAll", async () => {
    const a = makeFakeElement("a");
    const b = makeFakeElement("b");
    installDocumentStub([a, b]);
    installObserverStub();

    const { runRevealEffect } = await import("../reveal-on-scroll");
    const cleanup = runRevealEffect();

    const recorder = recorders[0];
    if (!recorder) throw new Error("expected one recorder");
    expect(recorder.observed).toHaveLength(2);
    expect(recorder.observed).toContain(a);
    expect(recorder.observed).toContain(b);

    cleanup?.();
  });

  it("adds 'is-in' on intersection and stops observing that element", async () => {
    const a = makeFakeElement("a");
    const b = makeFakeElement("b");
    installDocumentStub([a, b]);
    installObserverStub();

    const { runRevealEffect } = await import("../reveal-on-scroll");
    const cleanup = runRevealEffect();

    const recorder = recorders[0];
    if (!recorder) throw new Error("expected one recorder");
    // Simulate the browser firing the IO callback for element `a`
    // crossing the threshold; element `b` is not yet intersecting.
    recorder.callback(
      [
        { isIntersecting: true, target: a as unknown as Element },
        { isIntersecting: false, target: b as unknown as Element },
      ],
      recorder as unknown as IntersectionObserver,
    );

    expect(a.classList.has("is-in")).toBe(true);
    expect(b.classList.has("is-in")).toBe(false);
    expect(recorder.unobserved).toContain(a);
    expect(recorder.unobserved).not.toContain(b);

    cleanup?.();
  });

  it("disconnects the observer on cleanup (unmount)", async () => {
    installDocumentStub([makeFakeElement("a")]);
    installObserverStub();

    const { runRevealEffect } = await import("../reveal-on-scroll");
    const cleanup = runRevealEffect();
    cleanup?.();

    const recorder = recorders[0];
    if (!recorder) throw new Error("expected one recorder");
    expect(recorder.disconnected).toBe(true);
  });

  it("falls back to immediate visibility when IntersectionObserver is undefined (older Safari, jsdom)", async () => {
    const a = makeFakeElement("a");
    const b = makeFakeElement("b");
    installDocumentStub([a, b]);
    removeObserverStub();

    const { runRevealEffect } = await import("../reveal-on-scroll");
    runRevealEffect();

    expect(a.classList.has("is-in")).toBe(true);
    expect(b.classList.has("is-in")).toBe(true);
  });

  it("does nothing safely when document is undefined (SSR safety)", async () => {
    delete (globalThis as { document?: unknown }).document;
    installObserverStub();

    const { runRevealEffect } = await import("../reveal-on-scroll");
    expect(() => runRevealEffect()).not.toThrow();
    expect(recorders).toHaveLength(0);
  });
});
