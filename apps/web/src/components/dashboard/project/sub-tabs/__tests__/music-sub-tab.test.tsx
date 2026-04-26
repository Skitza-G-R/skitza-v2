import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Story 05 — full rewrite of the Music tab.
//
// The OLD music-sub-tab.tsx had a title-first add-track form (the
// user's main complaint: "when i click upload a track it opens me the
// place to add title instead of letting me uploading a track"). The
// NEW component:
//   - Empty state: full-bleed <DropZone variant="empty">
//   - Populated:    pinned <DropZone variant="pinned"> + <TrackRow> per track
//   - No more title-first form; no more `+ Version` button.
//
// Per CLAUDE.md test conventions, we pin the contract via source-text
// invariants on the .tsx file. The pure logic (title-derive,
// pickStatusCopy, nextVersionLabel, categorizeFiles) is covered in
// the helper tests. The wiring to the multipart upload pipeline is
// covered by the existing useMultipartUpload tests.

const SRC = readFileSync(
  new URL("../music-sub-tab.tsx", import.meta.url),
  "utf8",
);

describe("MusicSubTab source invariants (Story 05 — drop-first rewrite)", () => {
  it("is a client component", () => {
    expect(SRC.split("\n")[0]).toMatch(/^"use client"/);
  });

  it("imports the DropZone primitive", () => {
    expect(SRC).toMatch(/from\s+["'].*\/music\/drop-zone["']/);
    expect(SRC).toMatch(/DropZone/);
  });

  it("imports the TrackRow primitive", () => {
    expect(SRC).toMatch(/from\s+["'].*\/music\/track-row["']/);
    expect(SRC).toMatch(/TrackRow/);
  });

  it("imports the new server actions (createTrackFromUploadAction et al.)", () => {
    expect(SRC).toMatch(/createTrackFromUploadAction/);
    expect(SRC).toMatch(/addVersionFromUploadAction/);
    expect(SRC).toMatch(/setVersionStatusAction/);
  });

  it("uses the multipart upload hook", () => {
    // Existing pipeline — useMultipartUpload({ file, trackVersionId,
    // onComplete }) handles the PUT-parts dance.
    expect(SRC).toMatch(/useMultipartUpload/);
  });

  it("does NOT contain the OLD title-first form", () => {
    // The OLD MusicSubTab had `setShowTrack`, `newTrackTitle`, and a
    // `<form onSubmit={onCreateTrack}>` block. None of that should
    // remain — the new flow is purely drop / click → file picker.
    expect(SRC).not.toMatch(/setShowTrack/);
    expect(SRC).not.toMatch(/newTrackTitle/);
    expect(SRC).not.toMatch(/onCreateTrack\b/);
    expect(SRC).not.toMatch(/setNewVersionLabel/);
  });

  it("does NOT contain the OLD `+ Add track` button (which opened the form)", () => {
    // The old "+ Add track" was a Button that toggled `showTrack`.
    // In the new flow, the entry point is the DropZone itself (or the
    // pinned-top strip). The literal "+ Add track" string is allowed
    // ONLY inside a DropZone copy or a non-form button that opens the
    // file picker. The signal we pin: NO references to the old state
    // toggler.
    expect(SRC).not.toMatch(/\+ Add track[\s\S]{0,200}variant=["']secondary["']/);
  });

  it("does NOT use addProjectTrack / addTrackVersion (the legacy actions)", () => {
    // Those actions wrote rows via project.addTrack / project.addVersion
    // — the new flow goes through projectRoom.* mutations instead.
    expect(SRC).not.toMatch(/addProjectTrack\b/);
    expect(SRC).not.toMatch(/addTrackVersion\b/);
  });

  it("uses CSS variable colours, no hex / no Tailwind named palette", () => {
    expect(SRC).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(SRC).not.toMatch(/\b(?:bg|text|border)-(?:red|blue|green|yellow|gray|slate|zinc|neutral|stone)-\d/);
  });

  it("has tabpanel role + ARIA wiring (id=\"panel-music\" + aria-labelledby=\"tab-music\")", () => {
    // Sub-tab plumbing from S03.
    expect(SRC).toMatch(/role="tabpanel"/);
    expect(SRC).toMatch(/id="panel-music"/);
    expect(SRC).toMatch(/aria-labelledby="tab-music"/);
  });

  it("renders DropZone variant='empty' when there are no tracks", () => {
    // We can't render the component, but we can check the source
    // expresses the conditional: an empty branch that uses
    // variant="empty".
    expect(SRC).toMatch(/variant=["']empty["']/);
  });

  it("renders DropZone variant='pinned' for the populated state", () => {
    expect(SRC).toMatch(/variant=["']pinned["']/);
  });

  it("calls deriveTrackTitle when constructing optimistic preview rows", () => {
    // Optimistic UX — the preview row's title comes from the client
    // helper (mirrors the server's derivation).
    expect(SRC).toMatch(/deriveTrackTitle/);
  });

  it("calls categorizeFiles to filter dropped multi-files", () => {
    // Multi-file drop handling — non-audio files are reported as
    // rejected via toast.
    expect(SRC).toMatch(/categorizeFiles/);
  });

  it("uses router.refresh() to reconcile after an upload completes", () => {
    // Without React Query, the simplest reconciliation pattern is to
    // refresh the route on completion. Documented in the story
    // ("Don't try to update the React tree mid-upload from a server-
    // fetched data structure").
    expect(SRC).toMatch(/router\.refresh\(\)/);
  });
});

// Page-wiring invariant: page.tsx must invoke caller.projectRoom.music
// so the new payload flows into the rewritten component.
const PAGE_SRC = readFileSync(
  new URL(
    "../../../../../app/(app)/dashboard/projects/[id]/page.tsx",
    import.meta.url,
  ),
  "utf8",
);

describe("page.tsx invariant — projectRoom.music is wired (Story 05)", () => {
  it("calls caller.projectRoom.music({ projectId })", () => {
    expect(PAGE_SRC).toMatch(/caller\.projectRoom\.music/);
  });

  it("passes the new payload (tracks shape) into <MusicSubTab/>", () => {
    // Either via a single `music={…}` prop or an explicit `tracks={
    // payload.tracks}` shape. Loose grep for either form.
    const ok =
      /MusicSubTab[\s\S]{0,400}music={/.test(PAGE_SRC) ||
      /MusicSubTab[\s\S]{0,400}tracks={[^}]*\.tracks/.test(PAGE_SRC);
    expect(ok).toBe(true);
  });
});
