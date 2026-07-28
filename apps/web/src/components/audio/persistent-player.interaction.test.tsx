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
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/music",
}));

import {
  MiniWaveform,
  MobileFullPlayer,
  shouldCollapsePlayerDrag,
  type PlayerTrack,
} from "./persistent-player";

const track: PlayerTrack = {
  id: "version-1",
  audioUrl: "https://audio.example/version-1.mp3",
  title: "Lama",
  subtitle: "Lital Ohayon · V1",
  durationMs: 90_000,
};

function dispatchPointer(
  target: Element,
  type: "pointercancel" | "pointerdown" | "pointermove" | "pointerup",
  {
    clientX = 20,
    clientY,
    pointerId = 1,
  }: {
    clientX?: number;
    clientY: number;
    pointerId?: number;
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
      onTogglePlay={vi.fn()}
      onScrub={onScrub}
      onSkip={vi.fn()}
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
  it("follows a downward finger, reverses upward, and settles open without firing the tap action", () => {
    const onCollapse = vi.fn();
    renderFullPlayer({ onCollapse });

    const dialog = screen.getByRole("dialog", { name: "Now playing — Lama" });
    const handle = screen.getByRole("button", { name: "Minimize player" });

    dispatchPointer(handle, "pointerdown", { clientY: 60 });
    dispatchPointer(handle, "pointermove", { clientY: 260 });
    expect(dialog.style.transform).toBe("translateY(200px)");

    dispatchPointer(handle, "pointermove", { clientY: 120 });
    expect(dialog.style.transform).toBe("translateY(60px)");

    dispatchPointer(handle, "pointerup", { clientY: 120 });
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
    render(<MiniWaveform seed="version-1" progressPct={20} onScrub={onScrub} tall />);
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
