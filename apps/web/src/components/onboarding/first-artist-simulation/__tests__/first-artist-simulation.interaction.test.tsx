// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FirstArtistSimulation } from "../first-artist-simulation";
import { PREVIEW_SIMULATION_INPUT, SIMULATION_LABEL } from "../simulation-model";

const mocks = vi.hoisted(() => ({
  capture: vi.fn<(name: string, properties?: Record<string, unknown>) => void>(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("~/lib/observability/product-events", () => ({
  captureProductEvent: mocks.capture,
}));

const LINKS = {
  bringActiveWork: "/dashboard/clients-projects/bring-active-work",
  dashboard: "/dashboard",
  publicUrl: "https://skitza.app/join/maya-stone",
};

const HEADLINES = [
  "One link instead of 5 apps.",
  "Send your link.",
  "They book themselves.",
  "All demos in one library.",
  "Get paid first.",
  "Everything in one place.",
] as const;

function renderReel(input = PREVIEW_SIMULATION_INPUT) {
  const onOpenChange = vi.fn();
  render(<FirstArtistSimulation open onOpenChange={onOpenChange} input={input} links={LINKS} />);
  return { onOpenChange };
}

function dialog() {
  return screen.getByRole("dialog", { name: "Watch your first artist" });
}

function headline() {
  return within(dialog()).getByTestId("simulation-caption").textContent;
}

function picture() {
  return within(dialog()).getByTestId("simulation-picture");
}

function step() {
  return within(dialog()).getByTestId("simulation-step").textContent;
}

function next() {
  fireEvent.click(within(dialog()).getByRole("button", { name: /^(Next|Finish)$/ }));
}

// jsdom has no matchMedia. `matches: false` keeps reduced motion off, so the
// reel plays on its own timers exactly as it does in a browser.
function installMatchMedia(matches = false) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

describe("FirstArtistSimulation (SK-310 reel)", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    installMatchMedia();
    vi.stubGlobal("fetch", fetchSpy);
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    mocks.capture.mockReset();
    fetchSpy.mockReset();
  });

  it("walks six drawn screens, one payoff each, and lands on the action", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { onOpenChange } = renderReel();

    // 1 · The hook: the producer's own link, nothing sent.
    expect(headline()).toBe(HEADLINES[0]);
    expect(step()).toBe("1 / 6");
    expect(within(dialog()).getAllByText(SIMULATION_LABEL).length).toBeGreaterThan(0);
    // The example label is drawn on the screen itself, where it never truncates.
    expect(picture().textContent).toContain(SIMULATION_LABEL);
    expect(picture().textContent).toContain("skitza.app/join/maya-stone");
    expect(within(dialog()).queryByRole("img", { name: "Done" })).toBeNull();
    expect(within(dialog()).queryByRole("link")).toBeNull();

    // 2 · Her request, with the real product and price, stamped.
    next();
    expect(headline()).toBe(HEADLINES[1]);
    expect(picture().textContent).toContain("New request");
    expect(picture().textContent).toContain("Signature production");
    expect(picture().textContent).toContain("₪1,800");
    expect(within(picture()).getByRole("img", { name: "Done" })).toBeTruthy();

    // 3 · She books inside the open hours; the calendar line is the payoff.
    next();
    expect(headline()).toBe(HEADLINES[2]);
    expect(picture().textContent).toContain("Noya picks a time");
    expect(picture().textContent).toContain("Busy in Google");
    expect(picture().textContent).toContain("Added to Google Calendar");
    expect(within(picture()).getByRole("img", { name: "Done" })).toBeTruthy();

    // 4 · Her library, the note at 0:42, the version locked.
    next();
    expect(headline()).toBe(HEADLINES[3]);
    for (const text of [
      "Noya's library",
      "Blue Hour",
      "Night Drive",
      "Golden",
      "0:42",
      "Keep this vocal.",
    ]) {
      expect(picture().textContent).toContain(text);
    }
    expect(picture().textContent).toContain("v2 · waiting for approval");
    expect(picture().textContent).toContain("v2 approved and locked");
    expect(within(picture()).getByRole("img", { name: "Done" })).toBeTruthy();

    // 5 · The full price, paid, and the download opening.
    next();
    expect(headline()).toBe(HEADLINES[4]);
    expect(picture().textContent).toContain("₪1,800");
    expect(picture().textContent).toContain("Waiting for payment");
    expect(picture().textContent).toContain("Paid");
    expect(picture().textContent).toContain("Download locked");
    expect(picture().textContent).toContain("Download open");
    expect(within(picture()).getByRole("img", { name: "Done" })).toBeTruthy();

    // 6 · The studio, then the action.
    next();
    expect(headline()).toBe(HEADLINES[5]);
    expect(step()).toBe("6 / 6");
    expect(picture().textContent).toContain("Nothing waiting for you");
    expect(within(dialog()).getByRole("button", { name: "Finish" })).toBeTruthy();
    expect(within(dialog()).queryByRole("button", { name: "Skip" })).toBeNull();
    // The action rises inside the studio picture, so the sheet below never
    // grows and nothing on screen jumps when the last scene lands.
    const action = await within(picture()).findByRole(
      "link",
      { name: /Add your first client/ },
      { timeout: 4000 },
    );
    expect(action.getAttribute("href")).toBe(LINKS.bringActiveWork);
    expect(
      within(picture()).getByRole("link", { name: "Open dashboard" }).getAttribute("href"),
    ).toBe(LINKS.dashboard);
    await user.click(within(dialog()).getByRole("button", { name: "Copy my link" }));
    expect(writeText).toHaveBeenCalledWith(LINKS.publicUrl);
    await waitFor(() => {
      expect(within(dialog()).getByRole("button", { name: "Link copied" })).toBeTruthy();
    });

    // Finish closes without an early-exit event.
    next();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    const events = mocks.capture.mock.calls.map(([name]) => name);
    expect(events.filter((name) => name === "simulation_started")).toHaveLength(1);
    expect(events.filter((name) => name === "simulation_step")).toHaveLength(6);
    expect(events.filter((name) => name === "simulation_completed")).toHaveLength(1);
    expect(events).not.toContain("simulation_exited_early");
    expect(mocks.capture).toHaveBeenCalledWith("simulation_started", {
      steps: 6,
      product: PREVIEW_SIMULATION_INPUT.product.id,
    });
    expect(mocks.capture).toHaveBeenCalledWith("simulation_step", { step: 4, frame: "library" });
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 15_000);

  it("plays on its own, pauses, and moves on the arrow keys", async () => {
    renderReel();
    expect(headline()).toBe(HEADLINES[0]);

    // The hook runs 3.9 s and then advances by itself.
    await waitFor(
      () => {
        expect(headline()).toBe(HEADLINES[1]);
      },
      { timeout: 6000 },
    );

    const pause = within(dialog()).getByRole("button", { name: "Pause" });
    fireEvent.click(pause);
    expect(
      within(dialog()).getByRole("button", { name: "Play" }).getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.keyDown(dialog(), { key: "ArrowRight" });
    expect(headline()).toBe(HEADLINES[2]);
    fireEvent.keyDown(dialog(), { key: "ArrowLeft" });
    expect(headline()).toBe(HEADLINES[1]);
    fireEvent.keyDown(dialog(), { key: " " });
    expect(within(dialog()).getByRole("button", { name: "Pause" })).toBeTruthy();
  }, 10_000);

  it("skips straight to the action and reports an early close", () => {
    const { onOpenChange } = renderReel();
    next();
    expect(headline()).toBe(HEADLINES[1]);

    fireEvent.click(within(dialog()).getByRole("button", { name: "Close simulation" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.capture).toHaveBeenCalledWith("simulation_exited_early", {
      step: 2,
      frame: "link",
    });

    cleanup();
    renderReel();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Skip" }));
    expect(headline()).toBe(HEADLINES[5]);
    expect(mocks.capture).toHaveBeenCalledWith("simulation_completed", { steps: 6 });
  });

  it("drops the booking screen for a product without studio time", () => {
    renderReel({
      ...PREVIEW_SIMULATION_INPUT,
      product: { ...PREVIEW_SIMULATION_INPUT.product, durationMin: 0, sessionCount: 0 },
    });
    expect(step()).toBe("1 / 5");
    const seen: (string | null)[] = [];
    for (let index = 0; index < 5; index += 1) {
      seen.push(headline());
      if (index < 4) next();
    }
    expect(seen).toEqual(HEADLINES.filter((line) => line !== HEADLINES[2]));
  });

  it("lands on every final frame at once under reduced motion", async () => {
    installMatchMedia(true);
    renderReel();
    await waitFor(() => {
      expect(within(dialog()).queryByRole("button", { name: "Pause" })).toBeNull();
    });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Skip" }));
    expect(headline()).toBe(HEADLINES[5]);
    // No timer to wait for: the action is there with the screen.
    expect(within(dialog()).getByRole("link", { name: /Add your first client/ })).toBeTruthy();
  });
});
