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
