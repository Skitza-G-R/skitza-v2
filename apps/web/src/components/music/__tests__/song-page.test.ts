import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  activeVersionToPlayerTrack,
  deleteVersionAudioPolicy,
  isSongPageVersionPlayable,
  isTombstonedVersionLoaded,
  newestPlayableSongPageVersion,
  playButtonState,
  resolveInitialSongPageVersion,
  runOnlineMusicManagement,
  songCommentDraftRoute,
  type SongPageVersion,
} from "../song-page";
import { readRuntimeTextDraft, writeRuntimeTextDraft } from "~/lib/runtime-state/drafts";
import { RUNTIME_DRAFT_MAX_AGE_MS } from "~/lib/runtime-state/runtime-state";
import { MemoryStorage } from "~/lib/runtime-state/__tests__/memory-storage";

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
const managementDialogSrc = readFileSync(join(here, "..", "song-management-dialog.tsx"), "utf8");

// ─── activeVersionToPlayerTrack ──────────────────────────────────────

const baseTrack = {
  id: "t-1",
  title: "Sunset Mix",
  artist: null as string | null,
  projectId: "p-1",
  projectTitle: "Bob's EP",
  clientName: "Bob" as string | null,
  archivedAtIso: null as string | null,
  releasedAtIso: null as string | null,
  workflowStage: "mixing" as const,
  artistApprovalLocked: false,
};

function makeVersion(over: Partial<SongPageVersion> = {}): SongPageVersion {
  return {
    id: "v-1",
    label: "v3",
    audioUrl: "https://r2/audio/v-1.mp3",
    durationMs: 240_000,
    uploadedAtIso: "2026-05-06T12:00:00Z",
    producerMarkedFinalAtIso: null,
    artistApprovedAtIso: null,
    previouslyArtistApprovedAtIso: null,
    audioDeletedAtIso: null,
    // Default to null peaks so legacy-style fixtures keep working;
    // tests that care override via `over`.
    peaks: null,
    delivery: {
      purchaseId: "purchase-1",
      permission: "purchase_fully_paid",
      fullyPaid: true,
      remainingCents: 0,
      currency: "ILS",
      overdue: false,
      totalCents: 18_000,
    },
    ...over,
  };
}

describe("activeVersionToPlayerTrack — PlayerTrack payload", () => {
  it("builds id/audioUrl/title/durationMs from the version + track", () => {
    const v = makeVersion({
      id: "v-42",
      audioUrl: "https://r2/x.mp3",
      durationMs: 200_000,
      label: "v3",
    });
    const t = { ...baseTrack, title: "Sunset Mix" };
    const p = activeVersionToPlayerTrack(t, v, "producer");
    expect(p.id).toBe("v-42");
    expect(p.audioUrl).toBe("https://r2/x.mp3");
    expect(p.title).toBe("Sunset Mix");
    expect(p.durationMs).toBe(200_000);
    expect(p.cachePolicy).toBe("account-unlocked");
  });

  it("subtitle uses 'clientName · versionLabel' when clientName is set", () => {
    const p = activeVersionToPlayerTrack(
      { ...baseTrack, clientName: "Bob" },
      makeVersion({ label: "v3" }),
      "producer",
    );
    expect(p.subtitle).toBe("Bob · v3");
  });

  it("subtitle falls back to artist when clientName is null", () => {
    const p = activeVersionToPlayerTrack(
      { ...baseTrack, clientName: null, artist: "feat. Alice" },
      makeVersion({ label: "v2" }),
      "producer",
    );
    expect(p.subtitle).toBe("feat. Alice · v2");
  });

  it("subtitle falls back to projectTitle when clientName + artist are null", () => {
    const p = activeVersionToPlayerTrack(
      { ...baseTrack, clientName: null, artist: null, projectTitle: "Side EP" },
      makeVersion({ label: "v1" }),
      "producer",
    );
    expect(p.subtitle).toBe("Side EP · v1");
  });

  it("propagates audioUrl=null (PersistentPlayer handles the missing-src case)", () => {
    const p = activeVersionToPlayerTrack(baseTrack, makeVersion({ audioUrl: null }), "producer");
    expect(p.audioUrl).toBeNull();
    expect(p.cachePolicy).toBeUndefined();
  });

  it("propagates durationMs=null", () => {
    const p = activeVersionToPlayerTrack(baseTrack, makeVersion({ durationMs: null }), "producer");
    expect(p.durationMs).toBeNull();
  });

  it.each(["purchase_fully_paid", "version_override"] as const)(
    "marks an artist version unlocked only for exact backend permission %s",
    (permission) => {
      const version = makeVersion({
        delivery: {
          ...makeVersion().delivery,
          permission,
        },
      });
      expect(activeVersionToPlayerTrack(baseTrack, version, "artist").cachePolicy).toBe(
        "account-unlocked",
      );
    },
  );

  it("marks a producer-owned version explicitly even when artist payment is required", () => {
    const version = makeVersion({
      delivery: {
        ...makeVersion().delivery,
        permission: "payment_required",
      },
    });
    expect(activeVersionToPlayerTrack(baseTrack, version, "producer").cachePolicy).toBe(
      "account-unlocked",
    );
  });

  it.each(["payment_required", "audio_deleted"] as const)(
    "keeps artist version %s out of private byte caching",
    (permission) => {
      const version = makeVersion({
        delivery: {
          ...makeVersion().delivery,
          permission,
        },
      });
      expect(activeVersionToPlayerTrack(baseTrack, version, "artist").cachePolicy).toBeUndefined();
    },
  );

  it("defaults an unknown artist entitlement to no byte cache", () => {
    const version = makeVersion({
      delivery: {
        ...makeVersion().delivery,
        permission: "unknown_permission",
      } as unknown as SongPageVersion["delivery"],
    });
    expect(activeVersionToPlayerTrack(baseTrack, version, "artist").cachePolicy).toBeUndefined();
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

  it("an explicit audio tombstone stays disabled even if a stale URL is present", () => {
    const s = playButtonState({
      activeVersionId: "v-1",
      audioUrl: "https://r2/stale.mp3",
      audioDeletedAtIso: "2026-07-19T08:00:00Z",
      nowPlaying: { trackId: null, playing: false },
    });
    expect(s).toEqual({ label: "Play", disabled: true, action: "play-new" });
  });
});

describe("deleted-audio version selection", () => {
  const deletedNewest = makeVersion({
    id: "v-3",
    label: "V3",
    audioUrl: null,
    audioDeletedAtIso: "2026-07-19T08:00:00Z",
  });
  const playableOlder = makeVersion({ id: "v-2", label: "V2" });

  it("does not treat a tombstoned version as playable even if its URL is stale", () => {
    expect(
      isSongPageVersionPlayable({
        ...deletedNewest,
        audioUrl: "https://r2/stale.mp3",
      }),
    ).toBe(false);
  });

  it("identifies a stale loaded player after revalidation returns a tombstone", () => {
    expect(isTombstonedVersionLoaded([deletedNewest, playableOlder], "v-3")).toBe(true);
    expect(isTombstonedVersionLoaded([deletedNewest, playableOlder], "v-2")).toBe(false);
    expect(isTombstonedVersionLoaded([deletedNewest, playableOlder], null)).toBe(false);
  });

  it("falls back from a requested deleted version to the newest available audio", () => {
    expect(resolveInitialSongPageVersion([deletedNewest, playableOlder], "v-3")?.id).toBe("v-2");
  });

  it("keeps a requested playable version selected", () => {
    expect(resolveInitialSongPageVersion([deletedNewest, playableOlder], "v-2")?.id).toBe("v-2");
  });

  it("returns no playable version when every stored audio object is gone", () => {
    expect(newestPlayableSongPageVersion([deletedNewest])).toBeNull();
    // The deleted record still resolves as history so its comments remain viewable.
    expect(resolveInitialSongPageVersion([deletedNewest], "v-3")?.id).toBe("v-3");
  });
});

describe("deleteVersionAudioPolicy — pre-Released protection and Released warnings", () => {
  const current = makeVersion({ id: "v-3", label: "V3" });
  const older = makeVersion({ id: "v-2", label: "V2" });
  const finalOlder = makeVersion({
    id: "v-1",
    label: "V1",
    producerMarkedFinalAtIso: "2026-07-18T10:00:00Z",
  });

  it("blocks the newest playable current version before Released", () => {
    const policy = deleteVersionAudioPolicy({
      versions: [current, older],
      version: current,
      isReleased: false,
    });
    expect(policy.isCurrent).toBe(true);
    expect(policy.isReleased).toBe(false);
    expect(policy.canDelete).toBe(false);
    expect(policy.details.join(" ")).toMatch(/Before Released.*current/i);
  });

  it("blocks a producer-marked-final version before Released even when it is not current", () => {
    const policy = deleteVersionAudioPolicy({
      versions: [current, older, finalOlder],
      version: finalOlder,
      isReleased: false,
    });
    expect(policy.isFinal).toBe(true);
    expect(policy.isCurrent).toBe(false);
    expect(policy.canDelete).toBe(false);
    expect(policy.details.join(" ")).toMatch(/final/i);
  });

  it("allows an older ordinary version before Released", () => {
    const policy = deleteVersionAudioPolicy({
      versions: [current, older],
      version: older,
      isReleased: false,
    });
    expect(policy.isCurrent).toBe(false);
    expect(policy.isFinal).toBe(false);
    expect(policy.isLast).toBe(false);
    expect(policy.canDelete).toBe(true);
  });

  it("blocks the last stored audio before Released", () => {
    const policy = deleteVersionAudioPolicy({
      versions: [older],
      version: older,
      isReleased: false,
    });
    expect(policy.isLast).toBe(true);
    expect(policy.canDelete).toBe(false);
  });

  it("allows final/last audio after Released with the strongest public consequences", () => {
    const policy = deleteVersionAudioPolicy({
      versions: [finalOlder],
      version: finalOlder,
      isReleased: true,
    });
    expect(policy.isReleased).toBe(true);
    expect(policy.isFinal).toBe(true);
    expect(policy.isLast).toBe(true);
    expect(policy.canDelete).toBe(true);
    expect(policy.strongWarning).toBe(true);
    expect(policy.details.join(" ")).toMatch(/real stored audio/i);
    expect(policy.details.join(" ")).toMatch(/cannot be undone/i);
    expect(policy.details.join(" ")).toMatch(/history remains/i);
    expect(policy.details.join(" ")).toMatch(/portfolio entry.*public link disabled/i);
  });

  it("offers an idempotent storage-cleanup retry for an already tombstoned version", () => {
    const deleted = makeVersion({
      audioUrl: null,
      audioDeletedAtIso: "2026-07-19T08:00:00Z",
    });
    const policy = deleteVersionAudioPolicy({
      versions: [deleted],
      version: deleted,
      isReleased: true,
    });

    expect(policy.canDelete).toBe(true);
    expect(policy.isStorageCleanupRetry).toBe(true);
    expect(policy.details.join(" ")).toMatch(/safe to repeat/i);
  });

  it("names producer final status accurately in permanent deletion warnings", () => {
    const policy = deleteVersionAudioPolicy({
      versions: [current, finalOlder],
      version: finalOlder,
      isReleased: true,
    });
    expect(policy.details.join(" ")).toMatch(/producer-marked-final audio/i);
  });
});

// ─── Source-grep — wiring ────────────────────────────────────────────

describe("song-page.tsx — composer is at the TOP of the comments thread (founder feedback)", () => {
  it("renders the composer block BEFORE the visibleComments .map iterator", () => {
    // Founder asked to flip the layout: the new-comment input should
    // be the first thing producers see when they scroll to the
    // comments. Pin via source ordering — the composer's marker
    // ("Add a note at this timestamp") must appear before the
    // visibleComments mapping.
    const composerIdx = songPageSrc.indexOf("Add a note at this timestamp");
    const listIdx = songPageSrc.indexOf("visibleComments.map");
    expect(composerIdx).toBeGreaterThan(0);
    expect(listIdx).toBeGreaterThan(0);
    expect(composerIdx).toBeLessThan(listIdx);
  });
});

describe("song-page.tsx — composer pauses playback on focus + resumes on submit", () => {
  it("composer input has an onFocus handler that pauses if currently playing", () => {
    // Pattern: track wasPlayingBeforeFocus state, then call
    // playerToggle on focus + on submit. Pin both the state ref and
    // the toggle call in the source.
    expect(songPageSrc).toMatch(/wasPlayingBeforeFocus|pauseForTyping/);
    // The composer input must wire onFocus.
    expect(songPageSrc).toMatch(/onFocus=\{[^}]+\}/);
  });

  it("handleAddComment resumes playback if it was paused for typing", () => {
    expect(songPageSrc).toMatch(/playerToggle\(\)/);
  });
});

describe("song-page.tsx — composer timestamp follows the live player", () => {
  it("subscribes to PLAYER_EVENTS.time so currentMs ticks while audio plays", () => {
    // Without this, the composer's @mm:ss chip stays frozen at the
    // last click/drag position even while the dock advances. Founder
    // asked: "the comment time stamp should always be in sync with
    // the player time."
    expect(songPageSrc).toContain("PLAYER_EVENTS");
    expect(songPageSrc).toMatch(/addEventListener\(\s*PLAYER_EVENTS\.time/);
  });
});

describe("song-page.tsx — comments don't double-post on submit", () => {
  it("clears the optimistic entry by tempId in BOTH ok and !ok branches of l3AddComment", () => {
    // Bug: revalidatePath in the server action makes the page re-render
    // with the canonical row from the DB. Without filtering tempId out
    // of optimisticByVersion on success, both rows render → comment
    // appears twice. Fix: filter on both branches.
    //
    // Heuristic check: the source contains at least 2 occurrences of
    // a `.filter(...)` that mentions `tempId`. One for the failure
    // rollback, one for the success cleanup.
    const matches = songPageSrc.match(/\.filter\(\s*\([^)]*\)\s*=>\s*[^)]*tempId/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("song-page.tsx — comments are clickable + replyable (founder feedback)", () => {
  it("renders a 'Jump to' button per comment that seeks the player", () => {
    expect(songPageSrc).toContain('data-test="comment-jump"');
    // The button delegates through handleJumpToComment so we check
    // both the wiring AND that handleJumpToComment is the one calling
    // playerSeek.
    expect(songPageSrc).toMatch(
      /data-test="comment-jump"[\s\S]{0,400}?onClick=\{[^}]*handleJumpToComment\(/,
    );
    const jumpHandler = songPageSrc.match(/function handleJumpToComment[\s\S]*?\n {2}\}/);
    expect(jumpHandler).not.toBeNull();
    expect(jumpHandler?.[0]).toContain("playerSeek(");
  });

  it("renders a 'Reply' button per comment", () => {
    expect(songPageSrc).toContain('data-test="comment-reply"');
  });

  it("Reply pre-fills the composer with the @author handle and focuses it", () => {
    // When the producer clicks Reply, the composer should be ready to
    // receive their message — focus + a draft prefix make that
    // obvious. The controlled draft owns the value while the input ref
    // provides the focus target.
    const replySource = songPageSrc.slice(
      songPageSrc.indexOf("function handleReplyToComment"),
      songPageSrc.indexOf("function handlePlayToggle"),
    );
    expect(replySource).toContain("const input = draftRef.current");
    expect(replySource).toContain("commentDraft.setBody(prefix)");
    expect(replySource).toContain("input.focus()");
  });

  it("Reply avoids smooth scrolling when the user prefers reduced motion", () => {
    expect(songPageSrc).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
    expect(songPageSrc).toMatch(
      /scrollIntoView\(\{\s*block:\s*"center",\s*behavior:\s*reduceMotion\.matches\s*\?\s*"auto"\s*:\s*"smooth",?\s*\}\)/,
    );
  });

  it("the @timestamp chip on each comment is a button (not a span) so clicking it jumps", () => {
    // Pinned via data attr to keep the chip discoverable as a control.
    expect(songPageSrc).toContain('data-test="comment-timestamp"');
  });
});

describe("song-page.tsx — Download button uses same-origin server route (R2 CORS dodged)", () => {
  it("anchors the download to /api/download/<versionId> (server proxies + sets Content-Disposition)", () => {
    // Round 4 used a client-side fetch + blob path. R2 doesn't honour
    // CORS for the producer's preview origins, so the fetch threw
    // and the fallback opened the audio in a new tab (founder saw a
    // black page with the native audio player). Fix: route through a
    // same-origin Next API route that fetches server-side and streams
    // back with Content-Disposition: attachment.
    expect(songPageSrc).toMatch(/\/api\/download\/\$\{?activeVersion\.id\}?/);
  });

  it("does NOT call browser fetch on the audio URL anymore (would CORS-fail)", () => {
    expect(songPageSrc).not.toMatch(/fetch\(activeVersion\.audioUrl/);
  });
});

describe("song-page.tsx — resolved comments sink to the bottom + grey out (founder feedback)", () => {
  it("renders resolved comments at the END of the list when showResolved is on", () => {
    // The founder didn't want resolve to hide the message — they
    // wanted it greyed out + parked at the bottom + filterable. Pin
    // via a sort comparator that puts resolved last.
    expect(songPageSrc).toMatch(/sort\(\s*\([^)]*\)\s*=>\s*\{[\s\S]*?resolved/i);
  });

  it("defaults showResolved to true (so a Resolve action visibly sinks the comment, not deletes it)", () => {
    expect(songPageSrc).toMatch(/useState<boolean>\(true\)|useState\(true\)/);
  });
});

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
    expect(songPageSrc).toMatch(
      /data-test="waveform-play-button"[\s\S]{0,400}?onClick=\{handlePlayToggle\}/,
    );
  });
});

describe("song-page.tsx source — secondary actions and public sharing", () => {
  it("uses the reduced-motion-aware pop primitive for the actions menu", () => {
    expect(songPageSrc).toContain("sk-pop");
    expect(songPageSrc).not.toContain('animation: "skitza-pop-in');
  });

  it("uses a truly disabled control with a reason when audio cannot be downloaded", () => {
    const downloadControlSource = songPageSrc.slice(
      songPageSrc.indexOf("{canUseDownloadAction ?"),
      songPageSrc.indexOf(
        '{role === "producer" &&',
        songPageSrc.indexOf("{canUseDownloadAction ?"),
      ),
    );
    expect(downloadControlSource).not.toContain("aria-disabled");
    expect(downloadControlSource).toContain(
      "title={\n                          activeVersionDeleted",
    );
    expect(downloadControlSource).toContain(
      'type="button"\n                        role="menuitem"\n                        disabled',
    );
  });

  it("removes the local-only Favorite control", () => {
    expect(songPageSrc).not.toContain('"Add to favorites"');
    expect(songPageSrc).not.toContain('"Remove from favorites"');
    expect(songPageSrc).not.toContain("StarIcon");
    expect(songPageSrc).not.toContain("isFavorite");
  });

  it("uses the producer-controlled public-link surface instead of copying the private page URL", () => {
    expect(songPageSrc).toContain("SongPublicLinkControls");
    expect(songPageSrc).not.toContain('aria-label="Share with artist"');
    expect(songPageSrc).not.toContain("window.location.href");
  });

  it("Download button is rendered with an aria-label", () => {
    expect(songPageSrc).toContain('aria-label="Download"');
  });

  it("keeps the Download icon inline and removes the obsolete private-page share icon", () => {
    expect(songPageSrc).toContain("DownloadIcon");
    expect(songPageSrc).not.toContain("ShareIcon");
  });

  it("Download button reads from activeVersion.audioUrl (so version switch swaps the target)", () => {
    // The button's onClick must reference activeVersion.audioUrl so
    // switching to v2 / v1 also swaps which file gets downloaded.
    expect(songPageSrc).toContain("activeVersion.audioUrl");
  });
});

describe("song-page.tsx source — passes pre-computed peaks to the waveform", () => {
  it("passes initialPeaks={activeVersion.peaks} to Waveform50", () => {
    // The L3 song page reads peaks off the version row (server-pre-
    // computed at upload completion) and threads them into the
    // Waveform50's initialPeaks prop. Without this the page would
    // still decode client-side every time, defeating the migration.
    expect(songPageSrc).toMatch(/initialPeaks=\{activeVersion\.peaks\}/);
  });

  it("keeps peaksUrl as the client-decode fallback (legacy versions)", () => {
    // Both props ride together — peaks=null falls back to peaksUrl,
    // and a missing audioUrl skips both (audio still uploading).
    expect(songPageSrc).toMatch(
      /peaksUrl=\{activeVersionPlayable\s*\?\s*\(activeVersion\.audioUrl\s*\?\?\s*undefined\)/,
    );
  });
});

describe("song-page.tsx — SongPageVersion wire type carries peaks", () => {
  it("declares peaks: number[] | null on the wire-type record", () => {
    // Server returns peaks as JSONB → number[] | null over tRPC. The
    // wire type must include it so the page.tsx mapper can ship it
    // across the RSC → client boundary.
    expect(songPageSrc).toMatch(/peaks:\s*number\[\]\s*\|\s*null/);
  });
});

describe("song-page.tsx source — deleted audio remains history, not a player target", () => {
  it("carries an explicit audioDeletedAtIso tombstone on each version", () => {
    expect(songPageSrc).toMatch(/audioDeletedAtIso\?:\s*string\s*\|\s*null/);
  });

  it("renders an Audio deleted history state and keeps version comments selected by id", () => {
    expect(songPageSrc).toContain("Audio deleted");
    expect(songPageSrc).toMatch(
      /data\.comments\.filter\(\(c\)\s*=>\s*c\.versionId\s*===\s*activeVersionId\)/,
    );
  });

  it("gates download and waveform audio through the playable-version helper", () => {
    expect(songPageSrc).toContain("isSongPageVersionPlayable(activeVersion)");
  });
});

describe("song-page.tsx source — truthful comment mutations", () => {
  const addCommentSource = songPageSrc.slice(
    songPageSrc.indexOf("function handleAddComment"),
    songPageSrc.indexOf("function handleComposerFocus"),
  );
  const resolveCommentSource = songPageSrc.slice(
    songPageSrc.indexOf("function handleResolveToggle"),
    songPageSrc.indexOf("function handleProducerReadyToggle"),
  );

  it("keeps the draft until add-comment succeeds and rolls back transport failures", () => {
    expect(addCommentSource).toContain("commentDraft.preserveDraft(body)");
    expect(addCommentSource).toMatch(/try \{[\s\S]*await actions\.addComment/);
    expect(addCommentSource).toMatch(/catch[\s\S]*commentDraft\.setBody\(body\)/);
    expect(addCommentSource).toMatch(/if \(!res\.ok\)[\s\S]*commentDraft\.setBody\(body\)/);
    expect(addCommentSource).toMatch(/else|return/);
    expect(addCommentSource).toContain("commentDraft.clearDraft()");
  });

  it("blocks offline resolve/reopen and rolls back result and transport failures", () => {
    expect(resolveCommentSource).toMatch(/if \(!online\)/);
    expect(resolveCommentSource).toMatch(/try \{[\s\S]*await actions\.resolveComment/);
    expect(resolveCommentSource).toMatch(
      /if \(res\.ok\) return;[\s\S]*setResolvedOverrides[\s\S]*currentResolved/,
    );
    expect(resolveCommentSource).toMatch(/catch[\s\S]*setResolvedOverrides[\s\S]*currentResolved/);
  });
});

describe("song-page.tsx — truthful online mutation boundaries", () => {
  it("does not invoke artist approval or shared management actions while offline", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true } as const);

    await expect(runOnlineMusicManagement(false, action)).resolves.toEqual({
      ok: false,
      error: "Reconnect before making this change. Nothing was changed.",
    });
    expect(action).not.toHaveBeenCalled();

    await expect(runOnlineMusicManagement(true, action)).resolves.toEqual({ ok: true });
    expect(action).toHaveBeenCalledOnce();
  });

  it("blocks producer ready changes offline and catches transport failures before UI mutation", () => {
    const readySource = songPageSrc.slice(
      songPageSrc.indexOf("function handleProducerReadyToggle"),
      songPageSrc.indexOf("function handleJumpToComment"),
    );
    expect(readySource).toMatch(/if \(!online\)[\s\S]*No change was saved/);
    expect(readySource).toMatch(/try \{[\s\S]*await markReadyAction/);
    expect(readySource).toMatch(/catch[\s\S]*setError/);
    expect(readySource.indexOf("await markReadyAction")).toBeLessThan(
      readySource.indexOf("setProducerReadyOverrides"),
    );
  });
});

describe("song-page.tsx — drafts remain separate per active version", () => {
  it.each(["producer", "artist"] as const)(
    "recovers version A after switching A → B → A for the %s",
    (role) => {
      const storage = new MemoryStorage();
      const slot = role === "artist" ? "artist.song-comment-draft" : "producer.song-comment-draft";
      const identity = {
        slot,
        userId: `${role}-user`,
        contextId: role === "artist" ? "studio-id" : "producer-id",
      } as const;
      const writtenAt = 1_000;
      const versionA = {
        ...identity,
        route: songCommentDraftRoute(role, "version-a"),
        resourceId: "version-a",
        body: "Draft for A",
      };
      const versionB = {
        ...identity,
        route: songCommentDraftRoute(role, "version-b"),
        resourceId: "version-b",
        body: "Draft for B",
      };

      expect(writeRuntimeTextDraft(storage, versionA, writtenAt)).toBe(true);
      expect(writeRuntimeTextDraft(storage, versionB, writtenAt + 1)).toBe(true);

      expect(
        readRuntimeTextDraft(storage, versionA, writtenAt + RUNTIME_DRAFT_MAX_AGE_MS - 1),
      ).toEqual({
        resourceId: "version-a",
        body: "Draft for A",
      });
      expect(readRuntimeTextDraft(storage, versionB, writtenAt + 2)).toEqual({
        resourceId: "version-b",
        body: "Draft for B",
      });
    },
  );
});

describe("song-page.tsx source — producer L3 management", () => {
  it("carries independent song archive, release, and workflow state on the track wire", () => {
    expect(songPageSrc).toMatch(/archivedAtIso:\s*string\s*\|\s*null/);
    expect(songPageSrc).toMatch(/releasedAtIso:\s*string\s*\|\s*null/);
    expect(songPageSrc).toMatch(
      /workflowStage:\s*[\s\S]{0,160}["']brief["'][\s\S]{0,160}["']done["']/,
    );
  });

  it("declares every optional management callback with the agreed names", () => {
    for (const callback of [
      "renameSong",
      "editArtist",
      "setArchived",
      "markReleased",
      "renameVersion",
      "deleteVersionAudio",
    ]) {
      expect(songPageSrc).toContain(`${callback}?:`);
    }
    expect(songPageSrc).toContain("projectId: string");
    expect(songPageSrc).toContain("trackId: string");
    expect(songPageSrc).toContain("versionId: string");
  });

  it("keeps management producer-only and exposes all six actions from More", () => {
    expect(songPageSrc).toContain('role === "producer"');
    expect(songPageSrc).toContain("Rename song");
    expect(songPageSrc).toContain("Edit artist credit");
    expect(songPageSrc).toContain("Archive song");
    expect(songPageSrc).toContain("Restore song");
    expect(songPageSrc).toContain("Mark as Released");
    expect(songPageSrc).toContain("Rename version");
    expect(songPageSrc).toContain("Permanently delete audio");
    expect(songPageSrc).toContain("Retry storage cleanup");
  });

  it("keeps the More menu above the later song body so every action remains clickable", () => {
    expect(songPageSrc).toMatch(/<header className="[^"]*\bisolate\b[^"]*\bz-10\b[^"]*"/);
    expect(songPageSrc).toContain("right-0 z-30");
  });

  it("keeps the More menu inside true phone viewports", () => {
    expect(songPageSrc).toContain("max-[400px]:fixed");
    expect(songPageSrc).toContain("max-[400px]:inset-x-4");
    expect(songPageSrc).toContain("max-[400px]:max-h-[calc(100dvh-2rem)]");
  });

  it("keeps permanent deletion for playable versions and exposes retry for tombstones", () => {
    expect(songPageSrc).toMatch(/activeVersionPlayable[\s\S]{0,3000}Permanently delete audio/);
    expect(songPageSrc).toMatch(/Rename version/);
    expect(songPageSrc).toContain("Retry storage cleanup");
  });

  it("blocks archived-song comments with restore guidance without hiding playback/history", () => {
    expect(songPageSrc).toMatch(/songArchived/);
    expect(songPageSrc).toMatch(/Restore this song.*comments|restore.*add comments/i);
    expect(songPageSrc).toContain("isSongPageVersionPlayable(activeVersion)");
  });
});

describe("SongManagementDialog source — accessible responsive confirmation UI", () => {
  it("uses a Radix portal and dialog semantics", () => {
    expect(managementDialogSrc).toContain("@radix-ui/react-dialog");
    expect(managementDialogSrc).toContain("DialogPrimitive.Portal");
    expect(managementDialogSrc).toContain("DialogPrimitive.Title");
    expect(managementDialogSrc).toContain("DialogPrimitive.Description");
  });

  it("fits phone widths with 44px controls and large-radius text buttons", () => {
    expect(managementDialogSrc).toContain("w-[calc(100vw-2rem)]");
    expect(managementDialogSrc).toContain("max-h-[calc(100dvh-2rem)]");
    expect(managementDialogSrc).toContain("min-h-11");
    expect(managementDialogSrc).toContain("rounded-[var(--radius-lg)]");
  });

  it("surfaces action failures without closing the dialog", () => {
    expect(managementDialogSrc).toContain('role="alert"');
    expect(managementDialogSrc).toContain("result.error");
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

  it("the play button is mounted inside the action rail beside producer readiness", () => {
    // Pin the structural relationship without naming a specific class —
    // we just check both buttons live in the same JSX block. Easiest
    // proxy: Mark ready copy + Play helper appear in the same
    // file, and the action-rail comment exists. (The action rail is
    // the only place wrapping the producer-final button today.)
    expect(songPageSrc).toContain("Mark ready");
    expect(songPageSrc).toContain("playButtonState(");
  });

  it("keeps artist approval language separate from producer final language", () => {
    expect(songPageSrc).toContain("producerMarkedFinalAtIso");
    expect(songPageSrc).toContain("artistApprovedAtIso");
    expect(songPageSrc).toContain("Approve final version");
    expect(songPageSrc).toContain("Ready for artist");
    expect(songPageSrc).toContain("producer-marked-final audio");
  });
});

// ─── SK-32: role-aware project breadcrumb href ──────────────────────
//
// The topbar breadcrumb's <project> crumb links back to L2. The L2
// route shape differs between sides (producer puts /project/ in the
// middle; artist doesn't). If the href ever silently drops one
// branch, the artist breadcrumb would point at a 404. Source-grep is
// enough — we just need both URL shapes present and gated on `role`.

describe("L3 project breadcrumb href is role-aware", () => {
  it("uses /artist/music/<projectId> when role === 'artist'", () => {
    expect(songPageSrc).toMatch(
      /role\s*===\s*["']artist["'][\s\S]{0,80}\/artist\/music\/\$\{data\.track\.projectId\}/,
    );
  });

  it("uses /dashboard/music/project/<projectId> for the producer path", () => {
    expect(songPageSrc).toMatch(/\/dashboard\/music\/project\/\$\{data\.track\.projectId\}/);
  });

  it("the project crumb href is the role-derived value (not a hardcoded literal)", () => {
    // The breadcrumb item should reference `projectHref` (computed
    // once above the topbarCrumbs array), not inline either URL.
    expect(songPageSrc).toMatch(/href:\s*projectHref/);
  });
});

describe("song-page.tsx source — phone touch targets", () => {
  it("keeps the project-room link and comment Post button 44px tall on phones only", () => {
    expect(songPageSrc).toMatch(
      /data-test="project-room-link"[\s\S]{0,350}?className="[^"]*min-h-11[^"]*sm:min-h-0[^"]*"/,
    );
    expect(songPageSrc).toMatch(
      /data-test="comment-post"[\s\S]{0,350}?className="[^"]*min-h-11[^"]*sm:min-h-0[^"]*"/,
    );
    expect(songPageSrc).toMatch(
      /data-test="comment-input"[\s\S]{0,350}?className="[^"]*min-h-11[^"]*sm:min-h-0[^"]*"/,
    );
  });

  it("gives both resolved and active note actions real 44px phone hit boxes", () => {
    for (const control of ["timestamp", "jump", "reply", "resolve"]) {
      const matches = songPageSrc.match(
        new RegExp(
          `data-test="comment-${control}"[\\s\\S]{0,350}?className="[^"]*min-h-11[^"]*sm:min-h-0[^"]*"`,
          "g",
        ),
      );
      expect(matches, `${control} controls`).toHaveLength(2);
    }

    for (const control of ["timestamp", "jump", "reply", "resolve"]) {
      const matches = songPageSrc.match(
        new RegExp(
          `data-test="comment-${control}"[\\s\\S]{0,350}?className="[^"]*min-w-11[^"]*sm:min-w-0[^"]*"`,
          "g",
        ),
      );
      expect(matches, `${control} control widths`).toHaveLength(2);
    }
  });
});
