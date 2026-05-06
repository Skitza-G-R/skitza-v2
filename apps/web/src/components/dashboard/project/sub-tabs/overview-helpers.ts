// Pure helpers for the Project Room → Overview tab.
//
// Extracted out of overview-sub-tab.tsx so they can be unit-tested
// without mounting React. The tab itself is a "use client" component
// that pulls in next/link + relative-time helpers; keeping the data-
// shaping logic in a plain .ts module sidesteps the JSDOM dance and
// pins the behaviour we actually care about: ordering, slicing, and
// the "no events" path.

export type OverviewTimelineKind =
  | "created"
  | "session"
  | "track"
  | "version"
  | "comment"
  | "paid";

export type OverviewTimelineEvent =
  | { kind: "created"; at: Date; title: string }
  | { kind: "session"; at: Date; status: string }
  | { kind: "track"; at: Date; trackTitle: string }
  | { kind: "version"; at: Date; trackId: string; label: string }
  | {
      kind: "comment";
      at: Date;
      authorName: string;
      fromProducer: boolean;
      body: string;
    }
  | { kind: "paid"; at: Date };

export interface BuildOverviewTimelineInput {
  createdAt: Date;
  finalPaid: boolean;
  session: { startsAt: Date; status: string } | null;
  tracks: { createdAt: Date; title: string }[];
  versions: { uploadedAt: Date; trackId: string; label: string }[];
  comments: {
    createdAt: Date;
    authorName: string;
    fromProducer: boolean;
    body: string;
  }[];
}

/** Maximum number of events surfaced in the Overview tab's "key
 * activity" rail. Older events live in the dedicated Notes tab feed. */
export const OVERVIEW_TIMELINE_MAX = 6;

/**
 * Fold a project's tracks/versions/comments into a reverse-chronological
 * timeline of milestone events, capped at OVERVIEW_TIMELINE_MAX. Always
 * includes a "created" event at the head; appends a "session" event if
 * one is linked, and a "paid" event when finalPaid is true (using the
 * latest activity timestamp as a proxy since we don't carry a real
 * paid-at column).
 */
export function buildOverviewTimeline(
  input: BuildOverviewTimelineInput,
): OverviewTimelineEvent[] {
  const events: OverviewTimelineEvent[] = [];
  events.push({
    kind: "created",
    at: input.createdAt,
    title: "Project created",
  });
  if (input.session) {
    events.push({
      kind: "session",
      at: input.session.startsAt,
      status: input.session.status,
    });
  }
  for (const t of input.tracks) {
    events.push({ kind: "track", at: t.createdAt, trackTitle: t.title });
  }
  for (const v of input.versions) {
    events.push({
      kind: "version",
      at: v.uploadedAt,
      trackId: v.trackId,
      label: v.label,
    });
  }
  for (const c of input.comments) {
    events.push({
      kind: "comment",
      at: c.createdAt,
      authorName: c.authorName,
      fromProducer: c.fromProducer,
      body: c.body,
    });
  }
  if (input.finalPaid) {
    // No real paid_at column — fall back to the most recent activity
    // timestamp as a reasonable surrogate. The canonical ledger lives
    // in the invoices table + Stripe; this is a hint, not a source of
    // truth, and the comment in the original component flagged it as
    // such. If a paid_at column lands later, this branch becomes a
    // simple read.
    const latest =
      events.length > 0
        ? new Date(Math.max(...events.map((e) => e.at.valueOf())))
        : input.createdAt;
    events.push({ kind: "paid", at: latest });
  }
  events.sort((a, b) => b.at.valueOf() - a.at.valueOf());
  return events.slice(0, OVERVIEW_TIMELINE_MAX);
}

/**
 * Compute the "last activity" timestamp for the metadata card —
 * latest of project.updatedAt, the most recent version upload, and
 * the most recent comment. Used in two places (the meta card, and
 * potentially the headline copy), so it's worth a single canonical
 * reducer rather than two slightly-different inline ones.
 */
export function computeLastActivity(
  updatedAt: Date,
  versions: { uploadedAt: Date }[],
  comments: { createdAt: Date }[],
): Date {
  let latest = updatedAt;
  for (const v of versions) {
    if (v.uploadedAt > latest) latest = v.uploadedAt;
  }
  for (const c of comments) {
    if (c.createdAt > latest) latest = c.createdAt;
  }
  return latest;
}
