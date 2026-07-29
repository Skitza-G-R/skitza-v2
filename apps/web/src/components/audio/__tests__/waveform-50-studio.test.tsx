// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clampWaveformInitialMs,
  resampleWaveformHeights,
  resolveWaveformDensity,
  Waveform50,
  type WaveformComment,
} from "../waveform-50";

const player = vi.hoisted(() => ({
  seek: vi.fn(),
  trackId: null as string | null,
  playing: false,
}));

vi.mock("../persistent-player", () => ({
  PLAYER_EVENTS: { time: "skitza:test-player-time" },
  playerSeek: player.seek,
  useNowPlaying: () => ({
    trackId: player.trackId,
    playing: player.playing,
  }),
}));

beforeEach(() => {
  player.seek.mockReset();
  player.trackId = null;
  player.playing = false;
});

afterEach(() => {
  cleanup();
});

describe("Waveform50 studio density", () => {
  it("keeps the current 200-bar default and gives studio a responsive 96/200 split", () => {
    expect(resolveWaveformDensity(undefined, "default")).toEqual({
      mobile: 200,
      desktop: 200,
    });
    expect(resolveWaveformDensity(undefined, "studio")).toEqual({
      mobile: 96,
      desktop: 200,
    });
  });

  it("accepts a fixed density or separate mobile and desktop counts", () => {
    expect(resolveWaveformDensity(120, "studio")).toEqual({
      mobile: 120,
      desktop: 120,
    });
    expect(resolveWaveformDensity({ mobile: 72, desktop: 240 }, "studio")).toEqual({
      mobile: 72,
      desktop: 240,
    });
  });

  it("resamples one envelope to the requested responsive bar count", () => {
    expect(resampleWaveformHeights([0, 1], 3)).toEqual([0, 0.5, 1]);
  });

  it("renders separate mobile and desktop layers only when density is responsive", () => {
    const { container, rerender } = render(
      <Waveform50
        appearance="studio"
        density={{ mobile: 72, desktop: 180 }}
        durationMs={60_000}
        initialPeaks={[0.2, 0.8]}
      />,
    );

    let layers = container.querySelectorAll('[data-waveform-bars="studio"]');
    expect(layers).toHaveLength(2);
    expect(layers.item(0).children).toHaveLength(72);
    expect(layers.item(1).children).toHaveLength(180);

    rerender(
      <Waveform50
        appearance="studio"
        density={120}
        durationMs={60_000}
        initialPeaks={[0.2, 0.8]}
      />,
    );

    layers = container.querySelectorAll('[data-waveform-bars="studio"]');
    expect(layers).toHaveLength(1);
    expect(layers.item(0).children).toHaveLength(120);
  });
});

describe("Waveform50 studio markers", () => {
  it("uses amber for open notes, grey for resolved notes, and returns the selected comment", () => {
    const onCommentSelect = vi.fn();
    const openComment: WaveformComment = {
      id: "open-note",
      timeMs: 5_000,
      fromProducer: false,
      resolved: false,
    };
    const resolvedComment: WaveformComment = {
      id: "resolved-note",
      timeMs: 10_000,
      fromProducer: true,
      resolved: true,
    };

    render(
      <Waveform50
        appearance="studio"
        comments={[openComment, resolvedComment]}
        durationMs={60_000}
        onCommentSelect={onCommentSelect}
      />,
    );

    const openMarker = screen.getByRole("button", {
      name: "Open note at 0:05",
    });
    const resolvedMarker = screen.getByRole("button", {
      name: "Resolved note at 0:10",
    });

    expect(openMarker.className).toContain("--brand-primary");
    expect(resolvedMarker.className).toContain("--fg-muted");
    expect(resolvedMarker.getAttribute("data-comment-status")).toBe("resolved");

    fireEvent.click(resolvedMarker);

    expect(onCommentSelect).toHaveBeenCalledOnce();
    expect(onCommentSelect).toHaveBeenCalledWith(resolvedComment);
  });
});

describe("Waveform50 studio playhead", () => {
  it("uses a thin line without the default glow, pulse, or glass time pill", () => {
    player.trackId = "version-1";
    player.playing = true;

    const { container } = render(
      <Waveform50 appearance="studio" durationMs={60_000} initialMs={12_000} seed="version-1" />,
    );

    const playhead = container.querySelector('[data-waveform-playhead="studio"]');
    expect(playhead).not.toBeNull();
    expect(playhead?.querySelector("[data-waveform-playhead-line]")).not.toBeNull();
    expect(container.querySelector(".skitza-playing-glow")).toBeNull();
    expect(container.querySelector(".backdrop-blur-md")).toBeNull();
  });

  it("starts each new version at its supplied initialMs instead of resetting to zero", async () => {
    expect(clampWaveformInitialMs(75_000, 60_000)).toBe(60_000);
    expect(clampWaveformInitialMs(-1_000, 60_000)).toBe(0);

    const { rerender } = render(
      <Waveform50 appearance="studio" durationMs={60_000} initialMs={12_000} seed="version-1" />,
    );

    expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("12000");

    rerender(
      <Waveform50 appearance="studio" durationMs={60_000} initialMs={27_000} seed="version-2" />,
    );

    await waitFor(() => {
      expect(screen.getByRole("slider").getAttribute("aria-valuenow")).toBe("27000");
    });
  });
});
