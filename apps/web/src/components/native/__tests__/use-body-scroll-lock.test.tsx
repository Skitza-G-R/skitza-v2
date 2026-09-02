// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lockedBodyStyle, useBodyScrollLock } from "../use-body-scroll-lock";

function Harness({ locked }: { locked: boolean }) {
  useBodyScrollLock(locked);
  return null;
}

afterEach(() => {
  cleanup();
  document.body.removeAttribute("style");
  vi.restoreAllMocks();
});

describe("body scroll lock", () => {
  // `overflow: hidden` alone leaves the page behind a phone overlay with a
  // scrollable range, and iOS scrolls the document — not the overlay — to
  // reveal a focused field when the keyboard opens. Taking the body out of
  // flow is what removes that range.
  it("takes the document out of flow rather than only hiding overflow", () => {
    expect(lockedBodyStyle(320)).toEqual({
      position: "fixed",
      top: "-320px",
      left: "0",
      right: "0",
      width: "100%",
      overflow: "hidden",
    });
  });

  it("holds the page at its current offset and restores it on release", () => {
    vi.spyOn(window, "scrollY", "get").mockReturnValue(240);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    const view = render(<Harness locked />);

    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.top).toBe("-240px");
    expect(document.body.style.overflow).toBe("hidden");

    view.rerender(<Harness locked={false} />);

    expect(document.body.style.position).toBe("");
    expect(document.body.style.top).toBe("");
    expect(document.body.style.overflow).toBe("");
    expect(scrollTo).toHaveBeenCalledWith(0, 240);
  });

  it("leaves the body alone while unlocked and puts back styles it did not own", () => {
    vi.spyOn(window, "scrollY", "get").mockReturnValue(0);
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    document.body.style.overflow = "auto";

    const view = render(<Harness locked={false} />);
    expect(document.body.style.position).toBe("");
    expect(document.body.style.overflow).toBe("auto");

    view.rerender(<Harness locked />);
    expect(document.body.style.overflow).toBe("hidden");

    view.rerender(<Harness locked={false} />);
    expect(document.body.style.overflow).toBe("auto");
  });
});
