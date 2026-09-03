// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    prefetch,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
    prefetch?: boolean;
  }) => (
    <a href={href} data-prefetch={prefetch ? "true" : undefined} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/music",
}));

import {
  MiniWaveform,
  MobileDock,
  MobileFullPlayer,
  shouldCollapsePlayerDrag,
  type PlayerTrack,
  type PlayerTransport,
} from "./persistent-player";

const track: PlayerTrack = {
  id: "version-1",
  audioUrl: "https://audio.example/version-1.mp3",
  title: "Lama",
  subtitle: "Lital Ohayon · V1",
  durationMs: 90_000,
};

// Every surface takes the same transport bag; these tests only exercise
// gesture behaviour, so the handlers are stubs unless a case overrides one.
function transportStubs(overrides: Partial<PlayerTransport> = {}): PlayerTransport {
  return {
    loop: "off",
    shuffle: false,
    hasNext: true,
    onTogglePlay: vi.fn(),
    onScrub: vi.fn(),
    onSkip: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onCycleLoop: vi.fn(),
    onToggleShuffle: vi.fn(),
    onShare: vi.fn(),
    sharing: false,
    ...overrides,
  };
}

function dispatchPointer(
  target: Element,
  type: "lostpointercapture" | "pointercancel" | "pointerdown" | "pointermove" | "pointerup",
  {
    clientX = 20,
    clientY,
    pointerId = 1,
    timeStamp,
  }: {
    clientX?: number;
    clientY: number;
    pointerId?: number;
    timeStamp?: number;
  },
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX,
    clientY,
  });
  Object.defineProperties(event, {
    isPrimary: { value: true },
    pointerId: { value: pointerId },
    pointerType: { value: "touch" },
    ...(timeStamp === undefined ? {} : { timeStamp: { value: timeStamp } }),
  });
  fireEvent(target, event);
}

function renderFullPlayer({
  onCollapse = vi.fn(),
  onScrub = vi.fn(),
}: {
  onCollapse?: () => void;
  onScrub?: (pct: number) => void;
} = {}) {
  const collapseBtnRef = createRef<HTMLButtonElement>();
  const view = render(
    <MobileFullPlayer
      track={track}
      playing
      currentMs={9_000}
      durationMs={90_000}
      progressPct={10}
      {...transportStubs({ onScrub })}
      expanded
      onCollapse={onCollapse}
      collapseBtnRef={collapseBtnRef}
      pathname="/dashboard/music"
    />,
  );
  return { ...view, collapseBtnRef };
}

beforeEach(() => {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });
});

afterEach(cleanup);

describe("full player direct manipulation", () => {
  it("makes a collapsed full player genuinely non-painted", () => {
    const collapseBtnRef = createRef<HTMLButtonElement>();
    render(
      <MobileFullPlayer
        track={track}
        playing
        currentMs={9_000}
        durationMs={90_000}
        progressPct={10}
        {...transportStubs()}
        expanded={false}
        onCollapse={vi.fn()}
        collapseBtnRef={collapseBtnRef}
        pathname="/dashboard/music"
      />,
    );

    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog.getAttribute("aria-label")).toBe("Now playing — Lama");
    expect(dialog.getAttribute("data-player-state")).toBe("closed");
    expect(dialog.style.willChange).toBe("");
    expect(dialog.style.top).toBe("var(--sk-layout-viewport-top, 0px)");
    expect(dialog.style.bottom).toBe("auto");
    expect(dialog.style.height).toBe("var(--sk-layout-viewport-height, 100dvh)");
  });

  it("follows a downward finger, reverses upward, and settles open without firing the tap action", () => {
    const onCollapse = vi.fn();
    renderFullPlayer({ onCollapse });

    const dialog = screen.getByRole("dialog", { name: "Now playing — Lama" });
    const handle = screen.getByRole("button", { name: "Minimize player" });

    dispatchPointer(handle, "pointerdown", { clientY: 60, timeStamp: 1_000 });
    dispatchPointer(handle, "pointermove", { clientY: 260, timeStamp: 1_016 });
    expect(dialog.style.transform).toBe("translateY(200px)");

    dispatchPointer(handle, "pointermove", { clientY: 120, timeStamp: 1_032 });
    expect(dialog.style.transform).toBe("translateY(60px)");

    dispatchPointer(handle, "pointerup", { clientY: 120, timeStamp: 1_040 });
    fireEvent.click(handle);

    expect(dialog.style.transform).toBe("translateY(0px)");
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it("honors a final upward coordinate when pointerup shares the last move timestamp", () => {
    const onCollapse = vi.fn();
    renderFullPlayer({ onCollapse });
    const dialog = screen.getByRole("dialog", { name: "Now playing — Lama" });
    const handle = screen.getByRole("button", { name: "Minimize player" });

    dispatchPointer(handle, "pointerdown", { clientY: 40, timeStamp: 1_000 });
    dispatchPointer(handle, "pointermove", { clientY: 240, timeStamp: 1_016 });
    expect(dialog.style.transform).toBe("translateY(200px)");

    dispatchPointer(handle, "pointerup", { clientY: 88, timeStamp: 1_016 });
    fireEvent.click(handle);

    expect(dialog.style.transform).toBe("translateY(0px)");
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it("collapses after a sufficiently far drag", () => {
    const onCollapse = vi.fn();
    renderFullPlayer({ onCollapse });
    const handle = screen.getByRole("button", { name: "Minimize player" });

    dispatchPointer(handle, "pointerdown", { clientY: 40 });
    dispatchPointer(handle, "pointermove", { clientY: 300 });
    dispatchPointer(handle, "pointerup", { clientY: 300 });

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("settles by position after a quick short move is held stationary before release", () => {
    const onCollapse = vi.fn();
    renderFullPlayer({ onCollapse });
    const dialog = screen.getByRole("dialog", { name: "Now playing — Lama" });
    const handle = screen.getByRole("button", { name: "Minimize player" });

    dispatchPointer(handle, "pointerdown", { clientY: 40, timeStamp: 1_000 });
    dispatchPointer(handle, "pointermove", { clientY: 88, timeStamp: 1_016 });
    expect(dialog.style.transform).toBe("translateY(48px)");

    dispatchPointer(handle, "pointerup", { clientY: 88, timeStamp: 1_300 });
    fireEvent.click(handle);

    expect(dialog.style.transform).toBe("translateY(0px)");
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it("drops stale downward velocity when a paused drag ends with a tiny upward move", () => {
    const onCollapse = vi.fn();
    renderFullPlayer({ onCollapse });
    const dialog = screen.getByRole("dialog", { name: "Now playing — Lama" });
    const handle = screen.getByRole("button", { name: "Minimize player" });

    dispatchPointer(handle, "pointerdown", { clientY: 40, timeStamp: 1_000 });
    dispatchPointer(handle, "pointermove", { clientY: 88, timeStamp: 1_016 });
    expect(dialog.style.transform).toBe("translateY(48px)");

    dispatchPointer(handle, "pointermove", { clientY: 87, timeStamp: 1_300 });
    expect(dialog.style.transform).toBe("translateY(47px)");

    dispatchPointer(handle, "pointerup", { clientY: 87, timeStamp: 1_300 });
    fireEvent.click(handle);

    expect(dialog.style.transform).toBe("translateY(0px)");
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it("preserves a genuinely fresh downward flick", () => {
    const onCollapse = vi.fn();
    renderFullPlayer({ onCollapse });
    const handle = screen.getByRole("button", { name: "Minimize player" });

    dispatchPointer(handle, "pointerdown", { clientY: 40, timeStamp: 1_000 });
    dispatchPointer(handle, "pointermove", { clientY: 88, timeStamp: 1_016 });
    dispatchPointer(handle, "pointerup", { clientY: 88, timeStamp: 1_024 });

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("ignores descendant capture loss and completes the handle gesture on its owning button", () => {
    const onCollapse = vi.fn();
    renderFullPlayer({ onCollapse });
    const handle = screen.getByRole("button", { name: "Minimize player" });
    const grip = handle.querySelector("span");
    expect(grip).not.toBeNull();
    if (!grip) return;

    dispatchPointer(grip, "pointerdown", { clientY: 40, timeStamp: 1_000 });
    dispatchPointer(grip, "pointermove", { clientY: 300, timeStamp: 1_016 });
    dispatchPointer(grip, "lostpointercapture", { clientY: 300, timeStamp: 1_020 });
    dispatchPointer(handle, "pointerup", { clientY: 300, timeStamp: 1_024 });

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("cancels the handle gesture when its owning button actually loses capture", () => {
    const onCollapse = vi.fn();
    renderFullPlayer({ onCollapse });
    const dialog = screen.getByRole("dialog", { name: "Now playing — Lama" });
    const handle = screen.getByRole("button", { name: "Minimize player" });
    const grip = handle.querySelector("span");
    expect(grip).not.toBeNull();
    if (!grip) return;

    dispatchPointer(grip, "pointerdown", { clientY: 40, timeStamp: 1_000 });
    dispatchPointer(grip, "pointermove", { clientY: 180, timeStamp: 1_016 });
    expect(dialog.style.transform).toBe("translateY(140px)");

    dispatchPointer(handle, "lostpointercapture", { clientY: 180, timeStamp: 1_020 });
    dispatchPointer(handle, "pointerup", { clientY: 180, timeStamp: 1_024 });

    expect(dialog.style.transform).toBe("translateY(0px)");
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it("uses position or downward velocity to decide the release destination", () => {
    expect(
      shouldCollapsePlayerDrag({
        offsetY: 180,
        velocityY: 0.1,
        viewportHeight: 800,
      }),
    ).toBe(true);
    expect(
      shouldCollapsePlayerDrag({
        offsetY: 42,
        velocityY: 0.8,
        viewportHeight: 800,
      }),
    ).toBe(true);
    expect(
      shouldCollapsePlayerDrag({
        offsetY: 70,
        velocityY: -0.4,
        viewportHeight: 800,
      }),
    ).toBe(false);
  });

  it("preserves a simple tap on the handle as the accessible minimize action", () => {
    const onCollapse = vi.fn();
    renderFullPlayer({ onCollapse });

    fireEvent.click(screen.getByRole("button", { name: "Minimize player" }));

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});

describe("full player route lifecycle", () => {
  function mobileDock(hidden: boolean) {
    return (
      <div dir="rtl" lang="he">
        <MobileDock
          track={track}
          playing
          currentMs={9_000}
          durationMs={90_000}
          progressPct={10}
          {...transportStubs()}
          hidden={hidden}
          pathname="/dashboard/music"
        />
      </div>
    );
  }

  it("removes the modal layer and body lock as soon as the Song route hides the dock", () => {
    document.body.style.overflow = "auto";
    const view = render(mobileDock(false));

    fireEvent.click(screen.getByRole("button", { name: "Expand player" }));
    const dialog = screen.getByRole("dialog", { name: "Now playing — Lama" });
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.getAttribute("dir")).toBe("rtl");
    expect(dialog.getAttribute("lang")).toBe("he");
    expect(document.body.style.overflow).toBe("hidden");

    view.rerender(mobileDock(true));

    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
    expect(document.body.style.overflow).toBe("auto");
  });
});

describe("full player waveform scrubbing", () => {
  it("previews continuously while one finger moves and commits once on release", () => {
    const onScrub = vi.fn();
    const onCollapse = vi.fn();
    renderFullPlayer({ onScrub, onCollapse });
    const waveform = screen.getByRole("slider", { name: "Seek" });
    Object.defineProperty(waveform, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 10,
        y: 500,
        left: 10,
        top: 500,
        right: 210,
        bottom: 548,
        width: 200,
        height: 48,
        toJSON: () => ({}),
      }),
    });

    dispatchPointer(waveform, "pointerdown", { clientX: 50, clientY: 520 });
    dispatchPointer(waveform, "pointermove", { clientX: 110, clientY: 520 });
    expect(waveform.getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByText("0:45")).toBeTruthy();
    expect(onScrub).not.toHaveBeenCalled();

    dispatchPointer(waveform, "pointermove", { clientX: 170, clientY: 520 });
    expect(waveform.getAttribute("aria-valuenow")).toBe("80");
    expect(screen.getByText("1:12")).toBeTruthy();

    dispatchPointer(waveform, "pointerup", { clientX: 190, clientY: 520 });
    expect(onScrub).toHaveBeenCalledTimes(1);
    expect(onScrub).toHaveBeenCalledWith(90);
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it("keeps tap and keyboard seeking accessible", () => {
    const onScrub = vi.fn();
    render(<MiniWaveform track={track} progressPct={20} onScrub={onScrub} tall />);
    const waveform = screen.getByRole("slider", { name: "Seek" });
    Object.defineProperty(waveform, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 48,
        width: 200,
        height: 48,
        toJSON: () => ({}),
      }),
    });

    dispatchPointer(waveform, "pointerdown", { clientX: 100, clientY: 20 });
    dispatchPointer(waveform, "pointerup", { clientX: 100, clientY: 20 });
    expect(onScrub).toHaveBeenLastCalledWith(50);

    fireEvent.keyDown(waveform, { key: "ArrowRight" });
    expect(onScrub).toHaveBeenLastCalledWith(25);
  });

  it("ignores descendant capture loss and completes waveform scrubbing on its owning slider", () => {
    const onScrub = vi.fn();
    render(<MiniWaveform track={track} progressPct={20} onScrub={onScrub} tall />);
    const waveform = screen.getByRole("slider", { name: "Seek" });
    const bar = waveform.querySelector("span");
    expect(bar).not.toBeNull();
    if (!bar) return;
    Object.defineProperty(waveform, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 10,
        y: 0,
        left: 10,
        top: 0,
        right: 210,
        bottom: 48,
        width: 200,
        height: 48,
        toJSON: () => ({}),
      }),
    });

    dispatchPointer(bar, "pointerdown", { clientX: 50, clientY: 20 });
    dispatchPointer(bar, "lostpointercapture", { clientX: 50, clientY: 20 });
    dispatchPointer(waveform, "pointermove", { clientX: 170, clientY: 20 });
    expect(waveform.getAttribute("aria-valuenow")).toBe("80");

    dispatchPointer(waveform, "pointerup", { clientX: 190, clientY: 20 });
    expect(onScrub).toHaveBeenCalledTimes(1);
    expect(onScrub).toHaveBeenCalledWith(90);
  });

  it("cancels waveform scrubbing when its owning slider actually loses capture", () => {
    const onScrub = vi.fn();
    render(<MiniWaveform track={track} progressPct={20} onScrub={onScrub} tall />);
    const waveform = screen.getByRole("slider", { name: "Seek" });
    const bar = waveform.querySelector("span");
    expect(bar).not.toBeNull();
    if (!bar) return;
    Object.defineProperty(waveform, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 10,
        y: 0,
        left: 10,
        top: 0,
        right: 210,
        bottom: 48,
        width: 200,
        height: 48,
        toJSON: () => ({}),
      }),
    });

    dispatchPointer(bar, "pointerdown", { clientX: 50, clientY: 20 });
    dispatchPointer(waveform, "pointermove", { clientX: 110, clientY: 20 });
    expect(waveform.getAttribute("aria-valuenow")).toBe("50");

    dispatchPointer(waveform, "lostpointercapture", { clientX: 110, clientY: 20 });
    dispatchPointer(waveform, "pointerup", { clientX: 190, clientY: 20 });

    expect(waveform.getAttribute("aria-valuenow")).toBe("20");
    expect(onScrub).not.toHaveBeenCalled();
  });
});

describe("persistent mini-player entrance motion", () => {
  it("reuses the first-mount CSS entrance primitive with a reduced-motion fallback", () => {
    const playerSource = readFileSync(
      join(process.cwd(), "src/components/audio/persistent-player.tsx"),
      "utf8",
    );
    const globalCss = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

    expect(playerSource).toContain("sk-toast-in");
    expect(globalCss).toContain("@keyframes skitza-toast-in");
    expect(globalCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.sk-toast-in[\s\S]*?animation:\s*none/,
    );
  });

  it("keeps the full-player sheet transition in CSS so reduced motion can override it", () => {
    const playerSource = readFileSync(
      join(process.cwd(), "src/components/audio/persistent-player.tsx"),
      "utf8",
    );
    const globalCss = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

    expect(playerSource).toContain("mobile-full-player-sheet");
    expect(playerSource).not.toContain(
      'transition: "transform 340ms cubic-bezier(0.32, 0.72, 0, 1)"',
    );
    expect(globalCss).toMatch(
      /\.mobile-full-player-sheet\s*\{[\s\S]*?transition:\s*transform 340ms/,
    );
    expect(globalCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.mobile-full-player-sheet[\s\S]*?transition:\s*none/,
    );
  });
});

// ─── Transport wiring (SK player controls) ───────────────────────────
// The founder's report: "the next song button is not next song, it is
// next 15 seconds". Song skips and fine seeking are now separate
// controls, so each one has to reach a different handler.

describe("full player transport controls", () => {
  function button(name: string): HTMLButtonElement {
    return screen.getByRole<HTMLButtonElement>("button", { name });
  }

  function renderTransport(overrides: Partial<PlayerTransport> = {}) {
    const collapseBtnRef = createRef<HTMLButtonElement>();
    const transport = transportStubs(overrides);
    render(
      <MobileFullPlayer
        track={track}
        playing
        currentMs={9_000}
        durationMs={90_000}
        progressPct={10}
        {...transport}
        expanded
        onCollapse={vi.fn()}
        collapseBtnRef={collapseBtnRef}
        pathname="/dashboard/music"
      />,
    );
    return transport;
  }

  it("moves to the next and previous SONG, never a seek", () => {
    const transport = renderTransport();

    fireEvent.click(screen.getByRole("button", { name: "Next song" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous song" }));

    expect(transport.onNext).toHaveBeenCalledTimes(1);
    expect(transport.onPrevious).toHaveBeenCalledTimes(1);
    expect(transport.onSkip).not.toHaveBeenCalled();
  });

  it("nudges playback by exactly ten seconds in both directions", () => {
    const transport = renderTransport();

    fireEvent.click(screen.getByRole("button", { name: "Back 10 seconds" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward 10 seconds" }));

    expect(transport.onSkip).toHaveBeenNthCalledWith(1, -10_000);
    expect(transport.onSkip).toHaveBeenNthCalledWith(2, 10_000);
    expect(transport.onNext).not.toHaveBeenCalled();
  });

  it("disables next only at the end of the queue", () => {
    renderTransport({ hasNext: false });
    expect(button("Next song").disabled).toBe(true);
    // Previous always stays live: at the top of a queue it restarts the
    // song, which is what every music player does.
    expect(button("Previous song").disabled).toBe(false);
  });

  it("exposes shuffle and repeat state, not just a color change", () => {
    cleanup();
    const off = renderTransport();
    expect(button("Shuffle").getAttribute("aria-pressed")).toBe("false");
    expect(button("Repeat off").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button("Shuffle"));
    fireEvent.click(button("Repeat off"));
    expect(off.onToggleShuffle).toHaveBeenCalledTimes(1);
    expect(off.onCycleLoop).toHaveBeenCalledTimes(1);

    cleanup();
    renderTransport({ shuffle: true, loop: "one" });
    expect(button("Shuffle").getAttribute("aria-pressed")).toBe("true");
    expect(button("Repeat this song").getAttribute("aria-pressed")).toBe("true");
  });

  it("offers a share control that reports progress while the sheet is open", () => {
    const transport = renderTransport();
    fireEvent.click(screen.getByRole("button", { name: "Share song" }));
    expect(transport.onShare).toHaveBeenCalledTimes(1);

    cleanup();
    renderTransport({ sharing: true });
    expect(button("Share song").disabled).toBe(true);
  });
});

// ─── Real waveform ───────────────────────────────────────────────────

describe("dock waveform draws the real envelope", () => {
  function bars(): HTMLElement[] {
    const slider = screen.getByRole("slider", { name: "Seek" });
    return Array.from(slider.querySelectorAll<HTMLElement>("span"));
  }

  it("renders pre-computed peaks instead of the seeded placeholder", () => {
    // 64 values map 1:1 onto the full-screen player's bar count, so the
    // rendered heights are the supplied envelope with no resampling.
    const peaks = Array.from({ length: 64 }, (_, i) => (i === 0 ? 1 : 0.5));
    render(
      <MiniWaveform track={{ ...track, peaks }} progressPct={0} onScrub={vi.fn()} tall />,
    );

    const rendered = bars();
    expect(rendered).toHaveLength(64);
    expect(rendered[0]?.style.height).toBe("100%");
    expect(rendered[1]?.style.height).toBe("50%");
  });

  it("never fetches cross-origin audio to decode (no CORS grant for our origins)", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    // The fixture's audio lives on another origin, like a public R2 URL.
    render(<MiniWaveform track={track} progressPct={0} onScrub={vi.fn()} tall />);

    expect(fetchSpy).not.toHaveBeenCalled();
    // Still drawn: the seeded envelope holds the strip until real peaks
    // arrive, so the dock never shows an empty rail.
    expect(bars()).toHaveLength(64);
    vi.unstubAllGlobals();
  });
});
