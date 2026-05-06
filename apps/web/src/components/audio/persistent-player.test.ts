import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  expandHrefForTrack,
  fmtTime,
  pickDurationMs,
  PLAYER_EVENTS,
} from "./persistent-player";

// Source-grep helper — reads persistent-player.tsx so we can pin the
// floating-dock visual contract (dark sidebar background, rounded
// pill, expand + close buttons with visible icons, mobile variant)
// without booting React. Vitest runs in node env per repo convention.
const here = dirname(fileURLToPath(import.meta.url));
const PLAYER_PATH = join(here, "persistent-player.tsx");
const playerSrc = readFileSync(PLAYER_PATH, "utf8");

// ─── fmtTime ─────────────────────────────────────────────────────────
// fmtTime renders the "1:23 / 4:56" ticker in the persistent player
// and next to every comment timestamp in the library side panel.
// These cases pin the edges that show up in practice: malformed
// inputs (NaN, negative), sub-second, sub-minute, and multi-minute.
describe("persistent-player fmtTime", () => {
  it("renders 0:00 for non-finite input", () => {
    expect(fmtTime(Number.NaN)).toBe("0:00");
    expect(fmtTime(Number.POSITIVE_INFINITY)).toBe("0:00");
  });

  it("clamps negative values to 0:00", () => {
    expect(fmtTime(-100)).toBe("0:00");
  });

  it("renders seconds with zero-padding", () => {
    expect(fmtTime(5_000)).toBe("0:05");
    expect(fmtTime(45_000)).toBe("0:45");
  });

  it("renders minutes:seconds", () => {
    expect(fmtTime(65_000)).toBe("1:05");
    expect(fmtTime(83_000)).toBe("1:23");
  });

  it("renders multi-minute tracks", () => {
    expect(fmtTime(10 * 60 * 1000 + 7 * 1000)).toBe("10:07");
  });
});

// ─── pickDurationMs ──────────────────────────────────────────────────
// Producers reported the dock showing "0:04 / 0:00" because legacy
// track rows have no `durationMs` recorded in the database (peak
// generation hadn't run yet). Once the <audio> element loads, the
// element's own `duration` is authoritative — we should fall back to
// it. This helper picks the best source.

describe("pickDurationMs — fallback to live <audio> duration", () => {
  it("uses dbDurationMs when present and positive", () => {
    expect(pickDurationMs(180_000, 240)).toBe(180_000);
  });

  it("falls back to audioDurationSec * 1000 when dbDurationMs is null", () => {
    expect(pickDurationMs(null, 240)).toBe(240_000);
  });

  it("falls back to audioDurationSec * 1000 when dbDurationMs is 0", () => {
    expect(pickDurationMs(0, 222)).toBe(222_000);
  });

  it("returns null when both sources are missing", () => {
    expect(pickDurationMs(null, null)).toBe(null);
  });

  it("returns null when dbDurationMs is null and audioDurationSec is 0", () => {
    expect(pickDurationMs(null, 0)).toBe(null);
  });

  it("treats audioDurationSec NaN / Infinity as null (HLS streams report Infinity until loaded)", () => {
    expect(pickDurationMs(null, Number.NaN)).toBe(null);
    expect(pickDurationMs(null, Number.POSITIVE_INFINITY)).toBe(null);
  });

  it("rounds fractional audio duration to ms (no fractional ms in display)", () => {
    expect(pickDurationMs(null, 222.49)).toBe(222_490);
  });
});

// ─── expandHrefForTrack ──────────────────────────────────────────────
// The dock's expand button (maximize-2 icon) opens the L3 song page
// for the currently-playing track. The track's `id` is the version-id
// (PersistentPlayer keys playback by version-id), and the L3 route is
// /dashboard/music/<versionId>.

describe("expandHrefForTrack — link to L3 song page", () => {
  it("returns /dashboard/music/<trackId>", () => {
    expect(expandHrefForTrack({ id: "v-42", audioUrl: null, title: "", subtitle: "", durationMs: null }))
      .toBe("/dashboard/music/v-42");
  });
});

// ─── PLAYER_EVENTS — close event added ───────────────────────────────
describe("PLAYER_EVENTS contract", () => {
  it("exposes a 'close' event so any component can dismiss the dock", () => {
    expect(PLAYER_EVENTS.close).toBe("skitza:player:close");
  });

  it("preserves the existing event names (regression guard for downstream listeners)", () => {
    expect(PLAYER_EVENTS.set).toBe("skitza:player:set");
    expect(PLAYER_EVENTS.toggle).toBe("skitza:player:toggle");
    expect(PLAYER_EVENTS.seek).toBe("skitza:player:seek");
    expect(PLAYER_EVENTS.time).toBe("skitza:player:time");
  });
});

// ─── Source-grep: dock visual contract ───────────────────────────────
// Pins the dark rounded-pill aesthetic from notes/shell.jsx →
// FloatingPlayer. These don't simulate the DOM — they just confirm
// the JSX still names the right tokens / aria-labels / icons. If a
// future refactor strips one of these by accident the regression
// trips here at vitest time, not at the producer's eyes.

describe("PersistentPlayer source — dark rounded floating dock", () => {
  it("uses --bg-sidebar (dark) for the dock surface, NOT --bg-elevated (warm white)", () => {
    expect(playerSrc).toContain("--bg-sidebar");
  });

  it("renders a dedicated mobile dock variant (sits above the bottom nav)", () => {
    // We expose the mobile and desktop docks as named exports so each
    // can be tested + tuned independently; the parent PersistentPlayer
    // composes them with viewport-aware visibility classes.
    expect(playerSrc).toContain("DesktopDock");
    expect(playerSrc).toContain("MobileDock");
  });

  it("desktop dock is hidden on <md and visible on md+ (mobile dock vice versa)", () => {
    expect(playerSrc).toContain("hidden md:flex");
    expect(playerSrc).toContain("flex md:hidden");
  });
});

describe("PersistentPlayer source — close button (the user complained icons were missing)", () => {
  it("has a button with aria-label='Close player'", () => {
    expect(playerSrc).toContain('aria-label="Close player"');
  });

  it("close button onClick dispatches the new close helper (or PLAYER_EVENTS.close)", () => {
    // Either the playerClose() helper is called OR a CustomEvent is
    // fired with the close event name. Both paths are valid.
    expect(playerSrc).toMatch(/playerClose\(|PLAYER_EVENTS\.close/);
  });

  it("renders an X SVG inside the close button — never an empty circle", () => {
    // The mockup screenshot showed an empty circle because the icon
    // font failed to load. We use inline SVG to dodge that class of
    // bug. Pin: the close button's <svg> contains the X path lines.
    expect(playerSrc).toMatch(/CloseIcon|<svg[^>]*>[\s\S]*<line[^>]*x1="4"[^>]*y1="4"[^>]*x2="12"[^>]*y2="12"/);
  });
});

describe("PersistentPlayer source — play / pause icon (always visible)", () => {
  it("renders PlayIcon and PauseIcon as inline SVGs (no empty circle when state flips)", () => {
    expect(playerSrc).toContain("PlayIcon");
    expect(playerSrc).toContain("PauseIcon");
    // The play SVG: path with the triangle.
    expect(playerSrc).toMatch(/<path d="M3\.5 2\.5v7L9\.5 6z"/);
    // The pause SVG: two rounded bars.
    expect(playerSrc).toMatch(/<rect x="3" y="2\.5" width="2" height="7"/);
  });

  it("the central play/pause button is a circle with white fill (visual primary CTA)", () => {
    expect(playerSrc).toMatch(/rounded-full[^"]*bg-white/);
  });
});

describe("PersistentPlayer source — expand + skip controls", () => {
  it("renders an expand button labelled for screen readers", () => {
    expect(playerSrc).toMatch(/aria-label="Open song page"/);
  });

  it("expand link uses expandHrefForTrack so the URL stays in sync with the L3 route", () => {
    expect(playerSrc).toContain("expandHrefForTrack(");
  });

  it("renders Skip-back / Skip-forward 5% controls with aria-labels", () => {
    expect(playerSrc).toContain('aria-label="Skip back 5%"');
    expect(playerSrc).toContain('aria-label="Skip forward 5%"');
  });
});

describe("PersistentPlayer source — album art cover slot", () => {
  it("paints the cover with producerGradient(subtitle) so the dock matches the L1 list aesthetic", () => {
    // The subtitle carries "Client · Version" today (cf.
    // recent-uploads-shelf.cardPlayDetail). We hash on the subtitle
    // to derive the same per-client gradient the rest of the app uses
    // for artwork. Pinned via import + call site.
    expect(playerSrc).toContain('from "~/lib/_phase4-stubs/producer-color"');
    expect(playerSrc).toContain("producerGradient(");
  });
});

describe("PersistentPlayer source — dock progress visual is a mini waveform, not a thin line", () => {
  it("renders a MiniWaveform component (bar-style) instead of a flat scrub bar", () => {
    // Founder feedback on the v3 preview: the dock's progress strip
    // looked like a generic Bluetooth-speaker progress line. The
    // mockup specifies a row of small bars (like the hero waveform,
    // shrunken) so the dock reads as part of the music app's design
    // language rather than a generic media-session shim.
    expect(playerSrc).toContain("MiniWaveform");
  });

  it("the mini waveform renders multiple bar elements (the visual hint that distinguishes it from a bar line)", () => {
    // Pin the bar-array convention. A single <div> with a width:%
    // pattern is the OLD ScrubBar; a mapped array of bar spans is the
    // new MiniWaveform. We check for a `.map(` call inside MiniWaveform
    // that emits multiple bars.
    expect(playerSrc).toMatch(/MiniWaveform[\s\S]*?\.map\(/);
  });

  it("mini waveform is seeded by the track id so each track has a stable visual fingerprint", () => {
    // Same convention as Waveform50.seed — deterministic heights from
    // the track id. Two different tracks → distinguishable docks.
    expect(playerSrc).toMatch(/seededBars\(|seededHeights\(/);
  });

  it("mini waveform stays clickable for scrub (founder still needs to seek from the dock)", () => {
    // The bar layout must keep onClick working — losing it would be a
    // functional regression. The container needs `cursor-pointer` so
    // the click affordance stays discoverable.
    expect(playerSrc).toMatch(/MiniWaveform[\s\S]*?onClick/);
  });
});

describe("PersistentPlayer source — duration fallback (the 0:00 bug)", () => {
  it("calls pickDurationMs with both the db-recorded ms and the live <audio> duration", () => {
    // The fallback is only meaningful if both sources are passed in.
    // If the JSX ever drops one, the dock regresses to the bug the
    // user reported in the screenshot.
    expect(playerSrc).toMatch(/pickDurationMs\(/);
    expect(playerSrc).toContain(".duration"); // audio element ref
  });
});
