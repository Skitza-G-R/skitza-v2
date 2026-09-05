import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PLAYER_EVENTS,
  SEEK_STEP_MS,
  clampSeekMs,
  expandHrefForTrack,
  fmtTime,
  isSharedSongPagePathname,
  loopButtonLabel,
  pickDurationMs,
  sameOriginPeaksUrl,
  shareUrlForTrack,
} from "./persistent-player";

// Source-grep helper — reads persistent-player.tsx so we can pin the
// floating-dock visual contract (dark sidebar background, rounded
// pill, expand + close buttons with visible icons, mobile variant)
// without booting React. Vitest runs in node env per repo convention.
const here = dirname(fileURLToPath(import.meta.url));
const PLAYER_PATH = join(here, "persistent-player.tsx");
const playerSrc = readFileSync(PLAYER_PATH, "utf8");
const globalsCss = readFileSync(
  join(dirname(PLAYER_PATH), "..", "..", "app", "globals.css"),
  "utf8",
);

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
// The dock's expand button (maximize-2 icon) + title + cover all link
// to the L3 song page for the currently-playing track. Which L3 route
// depends on where the user currently is: producer routes inside
// /dashboard, artist routes inside /artist/music/song. The helper is
// pathname-driven so the dock works on every surface without each
// caller threading a role down.

const baseTrack = {
  id: "v-42",
  audioUrl: null,
  title: "",
  subtitle: "",
  durationMs: null,
};

describe("expandHrefForTrack — link to L3 song page", () => {
  it("on a producer dashboard route → /dashboard/music/<trackId>", () => {
    expect(expandHrefForTrack(baseTrack, "/dashboard/music")).toBe("/dashboard/music/v-42");
  });

  it("on an artist route → /artist/music/song/<trackId>", () => {
    expect(expandHrefForTrack(baseTrack, "/artist/music")).toBe("/artist/music/song/v-42");
  });

  it("on a non-music artist surface (e.g. /artist/book) → still routes to artist L3", () => {
    expect(expandHrefForTrack(baseTrack, "/artist/book")).toBe("/artist/music/song/v-42");
  });

  it("null pathname → producer URL (historical default for SSR or pre-mount)", () => {
    expect(expandHrefForTrack(baseTrack, null)).toBe("/dashboard/music/v-42");
  });
});

describe("isSharedSongPagePathname — hide the dock only on shared SongPage routes", () => {
  const versionId = "10000000-0000-4000-8000-000000000001";

  it.each([
    `/dashboard/music/${versionId}`,
    `/dashboard/music/${versionId}/`,
    `/artist/music/song/${versionId}`,
    `/artist/music/song/${versionId}/`,
  ])("matches %s", (pathname) => {
    expect(isSharedSongPagePathname(pathname)).toBe(true);
  });

  it.each([
    null,
    "/dashboard/music",
    `/dashboard/music/project/${versionId}`,
    `/dashboard/clients-projects/${versionId}/songs/${versionId}`,
    `/artist/music/${versionId}`,
    "/artist/music/song/not-a-version-id",
    `/listen/${versionId}`,
  ])("does not match %s", (pathname) => {
    expect(isSharedSongPagePathname(pathname)).toBe(false);
  });
});

describe("clampSeekMs — fixed 10 second transport", () => {
  it("clamps fixed millisecond jumps to the track boundaries", () => {
    expect(clampSeekMs(8_000, -SEEK_STEP_MS, 180_000)).toBe(0);
    expect(clampSeekMs(60_000, SEEK_STEP_MS, 180_000)).toBe(70_000);
    expect(clampSeekMs(175_000, SEEK_STEP_MS, 180_000)).toBe(180_000);
  });
});

// ─── Share ───────────────────────────────────────────────────────────
// The dock's share button hands out the same brand-canonical Song page
// address the Song page's own share control does, so a link copied from
// the player never points at a preview deployment.

describe("shareUrlForTrack", () => {
  it("builds a skitza.app producer address on dashboard routes", () => {
    expect(shareUrlForTrack(baseTrack, "/dashboard/music")).toBe(
      "https://skitza.app/dashboard/music/v-42",
    );
  });

  it("builds a skitza.app artist address on artist routes", () => {
    expect(shareUrlForTrack(baseTrack, "/artist/music")).toBe(
      "https://skitza.app/artist/music/song/v-42",
    );
  });
});

describe("loopButtonLabel", () => {
  it("names the current repeat state for assistive tech", () => {
    expect(loopButtonLabel("off")).toBe("Repeat off");
    expect(loopButtonLabel("all")).toBe("Repeat all");
    expect(loopButtonLabel("one")).toBe("Repeat this song");
  });
});

// ─── Real waveform source ────────────────────────────────────────────
// The dock decodes audio for its envelope only when the browser can
// actually fetch the bytes. Cross-origin object URLs have no CORS grant
// for our origins, so decoding them would fail on every track.

describe("sameOriginPeaksUrl", () => {
  const origin = "https://app.skitza.test";

  it("accepts the same-origin stream route and returns it unchanged", () => {
    // Unchanged matters: the string is the decode cache key shared with
    // the Song page hero, which passes this exact relative URL.
    expect(sameOriginPeaksUrl("/api/audio/stream/v-42", origin)).toBe("/api/audio/stream/v-42");
    expect(sameOriginPeaksUrl(`${origin}/api/audio/stream/v-42`, origin)).toBe(
      `${origin}/api/audio/stream/v-42`,
    );
  });

  it("rejects cross-origin audio (public R2 URLs have no CORS grant)", () => {
    expect(sameOriginPeaksUrl("https://r2.example/audio.mp3", origin)).toBeNull();
  });

  it("rejects blob, data and missing sources", () => {
    expect(sameOriginPeaksUrl("blob:https://app.skitza.test/abc", origin)).toBeNull();
    expect(sameOriginPeaksUrl("data:audio/mp3;base64,AAAA", origin)).toBeNull();
    expect(sameOriginPeaksUrl(null, origin)).toBeNull();
    expect(sameOriginPeaksUrl("/api/audio/stream/v-42", null)).toBeNull();
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
    expect(PLAYER_EVENTS.volume).toBe("skitza:player:volume");
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
    expect(playerSrc).toMatch(
      /CloseIcon|<svg[^>]*>[\s\S]*<line[^>]*x1="4"[^>]*y1="4"[^>]*x2="12"[^>]*y2="12"/,
    );
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

  it("does not prefetch the protected Song Page until the player link is clicked", () => {
    expect(playerSrc.match(/prefetch=\{false\}/g)).toHaveLength(4);
  });

  // The founder reported the arrow next to play jumping 15 seconds
  // instead of moving to the next song. Track skips now own the
  // triangle-and-bar arrows; fine seeking moved to its own ±10 second
  // pair with the step drawn inside the icon.
  it("renders song skips, not a seek, on the triangle-and-bar arrows", () => {
    expect(playerSrc).toContain('aria-label="Previous song"');
    expect(playerSrc).toContain('aria-label="Next song"');
    expect(playerSrc).toContain("onNext");
    expect(playerSrc).toContain("onPrevious");
    // No surface may label a fixed seek as a track skip again.
    expect(playerSrc).not.toMatch(/aria-label="(?:Back|Forward) 15 seconds"/);
    expect(playerSrc).not.toContain("onSkip(15_000)");
    expect(playerSrc).not.toContain("onSkip(-15_000)");
  });

  it("renders fixed 10-second back / forward seek controls with aria-labels", () => {
    expect(playerSrc).toContain('aria-label="Back 10 seconds"');
    expect(playerSrc).toContain('aria-label="Forward 10 seconds"');
    expect(playerSrc).toContain("onSkip(-SEEK_STEP_MS)");
    expect(playerSrc).toContain("onSkip(SEEK_STEP_MS)");
    expect(SEEK_STEP_MS).toBe(10_000);
  });

  it("renders shuffle, repeat and share controls on the dock", () => {
    expect(playerSrc).toContain('aria-label="Shuffle"');
    expect(playerSrc).toContain("loopButtonLabel(loop)");
    expect(playerSrc).toContain('aria-label="Share song"');
    // Repeat is tri-state and shuffle is a toggle — both must report
    // their state to assistive tech, not just recolor.
    expect(playerSrc).toContain("aria-pressed={shuffle}");
    expect(playerSrc).toContain('aria-pressed={loop !== "off"}');
  });

  it("keeps every compact dock transport target at least 44px", () => {
    const compactDockSrc = playerSrc.slice(
      playerSrc.indexOf("function DesktopDock"),
      playerSrc.indexOf("function MobileFullPlayer"),
    );

    expect(compactDockSrc).not.toMatch(/\bh-[89]\s+w-[89]\b/);
    // Read each control's own <button> block so a neighbour's sizing
    // can never stand in for a control that lost its 44px target.
    function transportButton(label: string): string {
      const blocks = compactDockSrc
        .split("<button")
        .filter((block) => block.includes(`aria-label="${label}"`));
      expect(blocks).toHaveLength(1);
      const block = blocks[0] ?? "";
      return block.slice(0, block.indexOf("</button>"));
    }

    for (const label of [
      "Previous song",
      "Next song",
      "Back 10 seconds",
      "Forward 10 seconds",
      "Shuffle",
    ]) {
      expect(transportButton(label)).toContain("min-h-11");
      expect(transportButton(label)).toContain("min-w-11");
    }
    expect(transportButton("Share song")).toMatch(/h-11[^"]*w-11/);
    expect(
      compactDockSrc.match(/aria-label="Close player"[\s\S]{0,240}className="[^"]*h-11[^"]*w-11/g),
    ).toHaveLength(2);
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

describe("PersistentPlayer source — reserves bottom padding so the dock doesn't hide page content", () => {
  it("reserves dock padding only when a visible dock has a loaded track", () => {
    // Founder reported: the dock overlaps the bottom of the comments
    // thread on the song page. The fix is global — every page mounted
    // under AppShell needs to reserve the dock's height when audio
    // is loaded. We toggle a data attribute on <body> so a single
    // CSS selector in globals.css adds the padding without each page
    // having to opt in.
    expect(playerSrc).toContain("state.track && !dockHidden");
    expect(playerSrc).toMatch(/document\.body[^;]*(?:dataset|setAttribute|classList)/);
  });

  it("makes hidden dock chrome inert and removes the full-player modal layer", () => {
    expect(playerSrc.match(/inert=\{hidden\}/g)).toHaveLength(2);
    expect(playerSrc).toContain('{mounted && !hidden && typeof document !== "undefined"');
  });
});

describe("PersistentPlayer source — dock truly centers the transport (founder asked twice)", () => {
  it("uses a 1fr-auto-1fr grid (or equivalent fixed-edges layout) so the center column sits visually centered", () => {
    // Round 5 of the centering issue. The founder said "still not
    // centered enough" after we moved to a fixed-200px LEFT block.
    // Symmetric flex columns or a 1fr_auto_1fr grid get the center
    // exactly in the middle of the dock width regardless of left/
    // right content imbalance.
    expect(playerSrc).toMatch(/grid-cols-\[1fr_auto_1fr\]/);
  });

  it("center transport carries a min-width so the inline waveform row doesn't collapse", () => {
    // Round 6 regression: switching to grid-cols-[1fr_auto_1fr]
    // shrunk the auto column down to the transport-buttons row
    // (~120px), starving the waveform/time row underneath. Without
    // a min-width on the center stack, MiniWaveform renders at 0px
    // and the founder sees a play-button-only dock. Pin: the center
    // stack carries `min-w-[<n>px]` (any n ≥ 320 is reasonable).
    expect(playerSrc).toMatch(/min-w-\[(?:3[2-9]\d|[4-9]\d{2})px\][^"]*flex-col[^"]*lg:flex/);
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

  it("draws the REAL envelope: payload peaks first, then a shared decode", () => {
    // The founder asked for a real waveform. Pre-computed peaks ride
    // down with the track and win outright; otherwise the dock decodes
    // the same-origin audio through the cache the L3 hero already
    // fills, so a track drawn once is never decoded twice.
    expect(playerSrc).toContain("track.peaks");
    expect(playerSrc).toContain("useAudioPeaks(decodeUrl, barCount, supplied ?? fallback)");
    expect(playerSrc).toContain("sameOriginPeaksUrl(track.audioUrl, origin)");
  });

  it("keeps the seeded pattern only as the pre-decode fallback", () => {
    // Deterministic heights from the track id, so the strip never
    // renders empty while the real envelope is still decoding.
    expect(playerSrc).toMatch(/seededBars\(|seededHeights\(/);
    expect(playerSrc).toContain("seededBars(seed, barCount)");
  });

  it("mini waveform stays clickable for scrub (founder still needs to seek from the dock)", () => {
    // The bar layout must keep onClick working — losing it would be a
    // functional regression. The container needs `cursor-pointer` so
    // the click affordance stays discoverable.
    expect(playerSrc).toMatch(/MiniWaveform[\s\S]*?onClick/);
  });

  it("keeps a 44px desktop slider target around the compact visual rail", () => {
    const miniWaveformSrc = playerSrc.slice(
      playerSrc.indexOf("function MiniWaveform"),
      playerSrc.indexOf("// ─── Time formatter"),
    );

    expect(miniWaveformSrc).toContain('tall ? "h-12" : "h-11"');
    expect(miniWaveformSrc).toContain(
      'tall ? "inset-0" : "inset-x-0 top-1/2 h-6 -translate-y-1/2"',
    );
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

describe("mobile dock glass", () => {
  // The mini player is the same material as the tab row it floats above, so it
  // reads the same recipe rather than carrying a second copy of the numbers.
  it("shares the tab row's glass recipe instead of a hardcoded pill", () => {
    expect(globalsCss).toMatch(
      /\.liquid-glass-bottom-nav__stack,\n\s+\.persistent-player-dock__glass \{/,
    );
    expect(globalsCss).toMatch(
      /\.persistent-player-dock__glass \{[\s\S]*?backdrop-filter: blur\(20px\) saturate\(var\(--sk-nav-glass-bleed\)\)/,
    );
    expect(playerSrc).toContain("persistent-player-dock__glass");
    // The old opaque pill and its hardcoded white ink are gone, so the dock
    // follows the theme the way the tab row does.
    expect(playerSrc).not.toContain('background: "#1A1A1A"');
  });

  // Anything that establishes a backdrop root hides the page from a
  // `backdrop-filter` beneath it, and THREE properties do that: `filter`,
  // `transform`, and `will-change` naming either. Measured with a hard colour
  // edge behind the bar, an identity `transform` left on the wrapper produced
  // 0.0px of blur while the computed style still read `blur(20px)` — the glass
  // was inert and nothing said so. All three are therefore conditional, and the
  // wrapper is completely untouched while the dock is visible.
  it("keeps the mobile dock's wrapper inert while it is visible", () => {
    const dock = playerSrc.slice(
      playerSrc.indexOf("export function MobileDock("),
      playerSrc.indexOf("export function MobileFullPlayer("),
    );
    expect(dock).not.toContain("filter: hidden");
    expect(dock).toContain('transform: hidden ? "translateY(120%) scale(0.98)" : "none"');
    expect(dock).toContain('willChange: hidden ? "transform, opacity" : "auto"');
    // A bare `willChange: "transform..."` would silently kill the blur again.
    expect(dock).not.toMatch(/willChange: "transform/);
  });
});
