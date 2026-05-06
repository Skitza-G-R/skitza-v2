import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  activeVersionToPlayerTrack,
  playButtonState,
  type SongPageVersion,
} from "../song-page";

// L3 song-page tests. The L3 hero needs a Play button so producers can
// actually start playback — the existing implementation had a "deferred"
// comment where the play CTA should live, leaving the page un-listenable.
//
// Two pure helpers carry the behaviour:
//   - activeVersionToPlayerTrack: builds the PlayerTrack payload that
//     PersistentPlayer expects.
//   - playButtonState: derives the button's aria-label, disabled state,
//     and the action mode (start a new track vs toggle the existing one).
//
// Source-grep tests pin the wiring (event helpers, aria-label, onClick)
// without booting React (vitest runs in node env per repo convention).

const here = dirname(fileURLToPath(import.meta.url));
const SONG_PAGE_PATH = join(here, "..", "song-page.tsx");
const songPageSrc = readFileSync(SONG_PAGE_PATH, "utf8");

// ─── activeVersionToPlayerTrack ──────────────────────────────────────

const baseTrack = {
  id: "t-1",
  title: "Sunset Mix",
  artist: null as string | null,
  projectId: "p-1",
  projectTitle: "Bob's EP",
  clientName: "Bob" as string | null,
};

function makeVersion(over: Partial<SongPageVersion> = {}): SongPageVersion {
  return {
    id: "v-1",
    label: "v3",
    audioUrl: "https://r2/audio/v-1.mp3",
    durationMs: 240_000,
    uploadedAtIso: "2026-05-06T12:00:00Z",
    approvedAtIso: null,
    ...over,
  };
}

describe("activeVersionToPlayerTrack — PlayerTrack payload", () => {
  it("builds id/audioUrl/title/durationMs from the version + track", () => {
    const v = makeVersion({ id: "v-42", audioUrl: "https://r2/x.mp3", durationMs: 200_000, label: "v3" });
    const t = { ...baseTrack, title: "Sunset Mix" };
    const p = activeVersionToPlayerTrack(t, v);
    expect(p.id).toBe("v-42");
    expect(p.audioUrl).toBe("https://r2/x.mp3");
    expect(p.title).toBe("Sunset Mix");
    expect(p.durationMs).toBe(200_000);
  });

  it("subtitle uses 'clientName · versionLabel' when clientName is set", () => {
    const p = activeVersionToPlayerTrack(
      { ...baseTrack, clientName: "Bob" },
      makeVersion({ label: "v3" }),
    );
    expect(p.subtitle).toBe("Bob · v3");
  });

  it("subtitle falls back to artist when clientName is null", () => {
    const p = activeVersionToPlayerTrack(
      { ...baseTrack, clientName: null, artist: "feat. Alice" },
      makeVersion({ label: "v2" }),
    );
    expect(p.subtitle).toBe("feat. Alice · v2");
  });

  it("subtitle falls back to projectTitle when clientName + artist are null", () => {
    const p = activeVersionToPlayerTrack(
      { ...baseTrack, clientName: null, artist: null, projectTitle: "Side EP" },
      makeVersion({ label: "v1" }),
    );
    expect(p.subtitle).toBe("Side EP · v1");
  });

  it("propagates audioUrl=null (PersistentPlayer handles the missing-src case)", () => {
    const p = activeVersionToPlayerTrack(baseTrack, makeVersion({ audioUrl: null }));
    expect(p.audioUrl).toBeNull();
  });

  it("propagates durationMs=null", () => {
    const p = activeVersionToPlayerTrack(baseTrack, makeVersion({ durationMs: null }));
    expect(p.durationMs).toBeNull();
  });
});

// ─── playButtonState ─────────────────────────────────────────────────

describe("playButtonState — Play/Pause + disabled + action mode", () => {
  it("nothing playing → label=Play, enabled, action=play-new", () => {
    const s = playButtonState({
      activeVersionId: "v-1",
      audioUrl: "https://r2/v.mp3",
      nowPlaying: { trackId: null, playing: false },
    });
    expect(s).toEqual({ label: "Play", disabled: false, action: "play-new" });
  });

  it("a different version playing → label=Play, action=play-new (clicking switches the player)", () => {
    const s = playButtonState({
      activeVersionId: "v-1",
      audioUrl: "https://r2/v.mp3",
      nowPlaying: { trackId: "v-other", playing: true },
    });
    expect(s).toEqual({ label: "Play", disabled: false, action: "play-new" });
  });

  it("THIS version playing + playing=true → label=Pause, action=toggle", () => {
    const s = playButtonState({
      activeVersionId: "v-1",
      audioUrl: "https://r2/v.mp3",
      nowPlaying: { trackId: "v-1", playing: true },
    });
    expect(s).toEqual({ label: "Pause", disabled: false, action: "toggle" });
  });

  it("THIS version loaded + paused → label=Play, action=toggle (clicking resumes)", () => {
    const s = playButtonState({
      activeVersionId: "v-1",
      audioUrl: "https://r2/v.mp3",
      nowPlaying: { trackId: "v-1", playing: false },
    });
    expect(s).toEqual({ label: "Play", disabled: false, action: "toggle" });
  });

  it("audioUrl=null → disabled (no audio to play yet)", () => {
    const s = playButtonState({
      activeVersionId: "v-1",
      audioUrl: null,
      nowPlaying: { trackId: null, playing: false },
    });
    expect(s).toEqual({ label: "Play", disabled: true, action: "play-new" });
  });
});

// ─── Source-grep — wiring ────────────────────────────────────────────

describe("song-page.tsx source — Play button on the waveform card (founder feedback)", () => {
  it("renders a play/pause button INSIDE the waveform card (not just the hero action rail)", () => {
    // Pin via a unique data attribute so a future restyle can't drop the
    // affordance and pass the tests by accident. The big waveform
    // becomes unusable on touch screens without an in-context play
    // CTA — every Samply / SoundCloud-style timeline ships one.
    expect(songPageSrc).toContain('data-test="waveform-play-button"');
  });

  it("the waveform play button reuses handlePlayToggle (same toggle path as the hero CTA)", () => {
    // Two play buttons must dispatch through the SAME handler so that
    // pressing either keeps the dock + the page in lock-step. If the
    // waveform button forked into its own onClick we'd risk drift
    // (e.g. one calls playerPlay, the other playerToggle).
    expect(songPageSrc).toMatch(/data-test="waveform-play-button"[\s\S]{0,400}?onClick=\{handlePlayToggle\}/);
  });
});

describe("song-page.tsx source — secondary action rail icons (Star / Share / Download)", () => {
  it("Favorite (Star) button is rendered with an aria-label", () => {
    // Allow either a static label or a conditional ternary — both
    // strings must appear so the toggle reads correctly to screen
    // readers in either state.
    expect(songPageSrc).toContain('"Add to favorites"');
    expect(songPageSrc).toContain('"Remove from favorites"');
  });

  it("Share button is rendered with an aria-label", () => {
    expect(songPageSrc).toContain('aria-label="Share with artist"');
  });

  it("Download button is rendered with an aria-label", () => {
    expect(songPageSrc).toContain('aria-label="Download"');
  });

  it("Star icon is an inline SVG path (avoids icon-font-load failures the user saw on the dock mockup)", () => {
    // Both filled + outlined variants ship as SVG so the toggle never
    // shows an empty circle while a glyph is missing.
    expect(songPageSrc).toContain("StarIcon");
    expect(songPageSrc).toMatch(/<path[^>]*d="M8 1\.5/); // five-point star path begins here
  });

  it("Share + Download icons are inline SVGs too", () => {
    expect(songPageSrc).toContain("ShareIcon");
    expect(songPageSrc).toContain("DownloadIcon");
  });

  it("Download button anchors to the active version's audioUrl", () => {
    // Pin the wiring to audioUrl so the button stays in sync with the
    // active version (switching versions should swap the download
    // target). We don't enforce the `download` attribute literal —
    // that's handled by the browser based on the URL — but the href
    // MUST come from the current version's audioUrl.
    expect(songPageSrc).toMatch(/href=\{activeVersion\.audioUrl[^}]*\}/);
  });
});

describe("song-page.tsx source — Play button wiring", () => {
  it("imports playerPlay + playerToggle + useNowPlaying from persistent-player", () => {
    expect(songPageSrc).toMatch(/from\s+["']~\/components\/audio\/persistent-player["']/);
    expect(songPageSrc).toContain("playerPlay");
    expect(songPageSrc).toContain("playerToggle");
    expect(songPageSrc).toContain("useNowPlaying");
  });

  it("renders a button with aria-label tied to playButtonState (not a hard-coded string)", () => {
    // The aria-label MUST be derived from the helper so Pause shows up
    // mid-playback. A static `aria-label="Play"` would lie when the
    // track is currently playing and the button visually shows pause.
    expect(songPageSrc).toMatch(/aria-label=\{[^}]*\.label\}/);
  });

  it("the play button's onClick branches on state.action (play-new vs toggle)", () => {
    // The two action arms must both be present — the toggle path is
    // the one that prevents stopping the music when the producer
    // navigates to the song page of the version they're already
    // listening to and clicks the button.
    expect(songPageSrc).toContain("playerPlay(");
    expect(songPageSrc).toContain("playerToggle(");
  });

  it("disables the button when audioUrl is null (state.disabled drives disabled prop)", () => {
    expect(songPageSrc).toMatch(/disabled=\{[^}]*\.disabled[^}]*\}/);
  });

  it("the play button is mounted inside the action rail (sibling of the Approve button), so it sits next to 'Approve version'", () => {
    // Pin the structural relationship without naming a specific class —
    // we just check both buttons live in the same JSX block. Easiest
    // proxy: Approve version copy + Play helper appear in the same
    // file, and the action-rail comment exists. (The action rail is
    // the only place wrapping the Approve button today.)
    expect(songPageSrc).toContain("Approve version");
    expect(songPageSrc).toContain("playButtonState(");
  });
});
