// Story 05 — pure helpers shared across the Music tab tree.
//
// These cover the bilateral-pill copy table, the next-version-label
// default for the drop-on-row gesture, and the audio/rejected split
// for multi-file drops. They live here so the .tsx components stay
// thin presentational shells (the repo doesn't ship jsdom + RTL, so
// branch coverage on the React layer goes through pure helpers like
// these — see CLAUDE.md test conventions).

// ─── Bilateral status pill ──────────────────────────────────────────
// One DB enum (track_versions.status), two copy maps. Producer view
// uses internal language ("Final"); artist view uses outcome-oriented
// language ("Approved"). The pill colour is bound to the enum, never
// the role — a "Final" pill (positive tone) and an "Approved" pill
// (positive tone) light up the same colour, just with different copy.

export type VersionStatus = "draft" | "revisit" | "final";
export type ViewerRole = "producer" | "artist";
export type StatusTone = "neutral" | "warn" | "positive";

export interface StatusCopy {
  label: string;
  tone: StatusTone;
}

const PRODUCER_COPY: Record<VersionStatus, StatusCopy> = {
  draft: { label: "Draft", tone: "neutral" },
  revisit: { label: "Revisit", tone: "warn" },
  final: { label: "Final", tone: "positive" },
};

const ARTIST_COPY: Record<VersionStatus, StatusCopy> = {
  draft: { label: "In progress", tone: "neutral" },
  revisit: { label: "Needs work", tone: "warn" },
  final: { label: "Approved", tone: "positive" },
};

export function pickStatusCopy(
  status: VersionStatus,
  viewer: ViewerRole,
): StatusCopy {
  return viewer === "producer" ? PRODUCER_COPY[status] : ARTIST_COPY[status];
}

// ─── Next version label (drop-on-row gesture) ───────────────────────
// When a producer drops a file onto an existing track row's top half,
// it becomes V<N+1>. We default to count + 1 because some producers
// rename versions ("stems", "rough mix") and parsing the existing
// labels for the highest V-number is brittle. count + 1 always picks
// a non-colliding label as long as the labels are unique to start with
// (which they are — Frame.io / Replay-style stacking is monotonic).

export function nextVersionLabel(existingLabels: string[]): string {
  return `V${String(existingLabels.length + 1)}`;
}

// ─── Audio / rejected split ─────────────────────────────────────────
// Multi-file drop: the user might drag a folder onto the Music tab
// that contains stems, a PDF brief, and album art. We accept the
// audio files and report the rest as rejected so the UI can toast a
// single "skipped X non-audio file(s)" message.
//
// Allowed extensions match the audio.signPart server validation
// (audio.ts) and the existing AudioUploader's accept list.

const AUDIO_EXTENSION_RE = /\.(wav|mp3|flac|m4a|aif|aiff)$/i;

export interface CategorizedFiles {
  audio: File[];
  rejected: File[];
}

export function categorizeFiles(files: File[]): CategorizedFiles {
  const audio: File[] = [];
  const rejected: File[] = [];
  for (const f of files) {
    if (AUDIO_EXTENSION_RE.test(f.name)) {
      audio.push(f);
    } else {
      rejected.push(f);
    }
  }
  return { audio, rejected };
}

// ─── Story 06 helpers — range comments + cross-version partition ────
// These are the pure-math + pure-logic pieces of the comment overlay.
// They live in the shared helpers file so the React components stay
// thin and the unit tests cover branch logic without needing jsdom.

// Format the time anchor on a comment thread. Point comments show a
// single timestamp; range comments show start–end with an en-dash. The
// en-dash (U+2013) — not a hyphen — is the typographically correct
// glyph for ranges.
//
//   formatRangeAnchor(30000, null)  → "0:30"
//   formatRangeAnchor(30000, 75000) → "0:30 – 1:15"
//
// Negative input is clamped to 0 to avoid the "-0:01" rendering bug
// when a malformed clientX produces a slightly-negative timestamp.
export function formatRangeAnchor(
  timestampMs: number,
  endTimestampMs: number | null,
): string {
  const start = formatMmSs(timestampMs);
  if (endTimestampMs === null) return start;
  return `${start} – ${formatMmSs(endTimestampMs)}`;
}

function formatMmSs(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const totalSec = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec - minutes * 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

// Drag math — convert pixel offset on a waveform container to ms (and
// back). The container can grow / shrink with the viewport; both
// directions read the live width from getBoundingClientRect.
//
// Clamps to [0, durationMs] so a stray dragend past the right edge
// doesn't produce a comment past the audio's end. Divide-by-zero is
// guarded explicitly — if the container hasn't measured yet, return 0
// rather than NaN (pure helper, no side effects).
export function pixelsToMs(
  px: number,
  containerWidth: number,
  durationMs: number,
): number {
  if (containerWidth <= 0) return 0;
  const fraction = px / containerWidth;
  const ms = Math.round(fraction * durationMs);
  if (ms < 0) return 0;
  if (ms > durationMs) return durationMs;
  return ms;
}

export function msToPixels(
  ms: number,
  containerWidth: number,
  durationMs: number,
): number {
  if (containerWidth <= 0 || durationMs <= 0) return 0;
  const fraction = ms / durationMs;
  return Math.round(fraction * containerWidth);
}

// Drag classification — point vs range. Below the threshold (default
// 200ms) the drag is treated as a point comment anchored at startMs;
// at-or-above threshold, the drag is a range with min/max normalised
// (left-to-right and right-to-left drags both produce the same row,
// which keeps the SQL CHECK end > start happy).
//
// 200ms default avoids accidental ranges from imprecise clicks — most
// "intended click" mouseups land within ~50–100ms of the mousedown.
export type DragClassification =
  | { kind: "point"; timestampMs: number }
  | { kind: "range"; timestampMs: number; endTimestampMs: number };

export function classifyDrag(
  startMs: number,
  endMs: number,
  thresholdMs = 200,
): DragClassification {
  const span = Math.abs(endMs - startMs);
  if (span < thresholdMs) {
    return { kind: "point", timestampMs: startMs };
  }
  return {
    kind: "range",
    timestampMs: Math.min(startMs, endMs),
    endTimestampMs: Math.max(startMs, endMs),
  };
}

// Cross-version partition. The Music tab's `unresolvedComments` payload
// joins comments across ALL versions of a track; the Comments panel
// renders them in three buckets:
//   1. onActive          — comments authored on the active version
//   2. fromOtherVersions — unresolved comments from earlier versions
//                          (rendered with `(from V<N>)` subscript)
//   3. resolved          — never shown in the panel (returned for
//                          symmetry / future audit views)
//
// A comment is "resolved" when its `resolvedAt` is non-null. The
// projectRoom.music procedure (S02) already filters by resolvedAt IS
// NULL, so in production this bucket is always empty — but we accept
// it gracefully so the helper composes with future stores that include
// resolved rows (artist-side history view, etc.).
export interface CommentForPartition {
  id: string;
  versionId: string;
  versionLabel: string;
  authorName: string;
  body: string;
  timestampMs: number;
  endTimestampMs: number | null;
  fromProducer: boolean;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface PartitionedComments {
  onActive: CommentForPartition[];
  fromOtherVersions: CommentForPartition[];
  resolved: CommentForPartition[];
}

export function partitionComments(
  comments: CommentForPartition[],
  activeVersionId: string,
): PartitionedComments {
  const onActive: CommentForPartition[] = [];
  const fromOtherVersions: CommentForPartition[] = [];
  const resolved: CommentForPartition[] = [];
  for (const c of comments) {
    if (c.resolvedAt !== null) {
      resolved.push(c);
    } else if (c.versionId === activeVersionId) {
      onActive.push(c);
    } else {
      fromOtherVersions.push(c);
    }
  }
  return { onActive, fromOtherVersions, resolved };
}
