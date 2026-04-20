import { describe, expect, it } from "vitest";

import {
  CLOSED,
  STEPS,
  TOUR_STORAGE_KEY,
  back,
  clearTourSeen,
  currentStep,
  hasSeenTour,
  isClosed,
  markTourSeen,
  next,
  skip,
  start,
  type StorageLike,
} from "../coachmark-tour-steps";

// Minimal in-memory storage stub so we can exercise the flag helpers
// without a browser. Mirrors the Storage contract shape hasSeenTour,
// markTourSeen, and clearTourSeen rely on.
function makeStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe("coachmark tour — STEPS catalogue", () => {
  it("defines exactly 7 steps", () => {
    expect(STEPS).toHaveLength(7);
  });

  it("opens with a welcome step and closes with ⌘K", () => {
    expect(STEPS[0]?.id).toBe("welcome");
    expect(STEPS[STEPS.length - 1]?.id).toBe("command-k");
  });

  it("has a spotlight target for the 5 middle steps", () => {
    // Welcome + ⌘K are centered modals (no target); everything else
    // names a `data-tour-id` the runtime looks up.
    expect(STEPS[0]?.targetId).toBeUndefined();
    expect(STEPS[STEPS.length - 1]?.targetId).toBeUndefined();
    for (let i = 1; i < STEPS.length - 1; i += 1) {
      expect(STEPS[i]?.targetId, `step ${i.toString()} targetId`).toBeDefined();
    }
  });

  it("targets the expected surfaces in order", () => {
    expect(STEPS[1]?.targetId).toBe("sidebar-nav");
    expect(STEPS[2]?.targetId).toBe("share-link-card");
    expect(STEPS[3]?.targetId).toBe("quick-actions");
    expect(STEPS[4]?.targetId).toBe("today-inbox");
    expect(STEPS[5]?.targetId).toBe("nav-projects");
  });
});

describe("coachmark tour — transitions", () => {
  it("start() opens on step 0", () => {
    const s = start();
    expect(s.index).toBe(0);
    expect(isClosed(s)).toBe(false);
    expect(currentStep(s)?.id).toBe("welcome");
  });

  it("next() advances step-by-step through the catalogue", () => {
    let s = start();
    for (let i = 0; i < STEPS.length - 1; i += 1) {
      s = next(s);
      expect(s.index).toBe(i + 1);
      expect(currentStep(s)?.id).toBe(STEPS[i + 1]?.id);
    }
  });

  it("next() from the final step closes the tour", () => {
    // Walk to the last step.
    let s = start();
    while (s.index < STEPS.length - 1) {
      s = next(s);
    }
    expect(s.index).toBe(STEPS.length - 1);
    const closed = next(s);
    expect(isClosed(closed)).toBe(true);
    expect(currentStep(closed)).toBeNull();
  });

  it("back() moves to the previous step but stays on step 0 at the start", () => {
    const s0 = start();
    expect(back(s0)).toEqual(s0);
    const s1 = next(s0);
    expect(back(s1)).toEqual(s0);
  });

  it("skip() always yields the closed state", () => {
    expect(skip()).toEqual(CLOSED);
    expect(isClosed(skip())).toBe(true);
  });

  it("next() on CLOSED is a no-op (defensive)", () => {
    // Already closed → transitions ignored. The component never hits this
    // path (the UI is hidden when closed), but guarding keeps the machine
    // safe to call from an out-of-order effect.
    expect(next(CLOSED)).toEqual(CLOSED);
    expect(back(CLOSED)).toEqual(CLOSED);
  });
});

describe("coachmark tour — localStorage flag", () => {
  it("reads `1` as seen and any other shape (or missing) as not-seen", () => {
    const empty = makeStorage();
    expect(hasSeenTour(empty)).toBe(false);
    const seen = makeStorage({ [TOUR_STORAGE_KEY]: "1" });
    expect(hasSeenTour(seen)).toBe(true);
    const bogus = makeStorage({ [TOUR_STORAGE_KEY]: "yes" });
    expect(hasSeenTour(bogus)).toBe(false);
  });

  it("markTourSeen writes `1` to the expected key", () => {
    const s = makeStorage();
    markTourSeen(s);
    expect(s.getItem(TOUR_STORAGE_KEY)).toBe("1");
  });

  it("clearTourSeen removes the key", () => {
    const s = makeStorage({ [TOUR_STORAGE_KEY]: "1" });
    clearTourSeen(s);
    expect(s.getItem(TOUR_STORAGE_KEY)).toBeNull();
  });

  it("tolerates a null storage (SSR) without throwing", () => {
    expect(() => {
      markTourSeen(null);
    }).not.toThrow();
    expect(() => {
      clearTourSeen(null);
    }).not.toThrow();
    expect(hasSeenTour(null)).toBe(false);
  });

  it("tolerates a storage that throws on access (private mode)", () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(hasSeenTour(throwing)).toBe(false);
    expect(() => {
      markTourSeen(throwing);
    }).not.toThrow();
    expect(() => {
      clearTourSeen(throwing);
    }).not.toThrow();
  });
});
