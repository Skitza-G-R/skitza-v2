// Song-page comment helpers. Pure, no React imports — tested by
// __tests__/song-comments.test.ts.
//
// Two responsibilities:
// 1) buildCommentMarkers: convert {at: sec} comments into {leftPct} for
//    rendering as dots/avatars on top of the waveform.
// 2) rawCommentToVisible: shape the raw track_comments DB row into the
//    structure the SongPage renders (mine flag, initials, who, when).

import { initialsOf, relTime } from "./data-mapping";

export type RawComment = {
  id: string;
  versionId: string;
  timestampMs: number;
  body: string;
  fromProducer: boolean;
  authorEmail: string | null;
  createdAt: Date;
};

export type VisibleComment = {
  id: string;
  at: number; // seconds
  text: string;
  who: string;
  initials: string;
  when: string; // relative ago string
  mine: boolean;
};

export type CommentMarker = {
  id: string;
  leftPct: number; // 0..100, clamped
};

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

export function buildCommentMarkers(
  comments: { id: string; at: number }[],
  durationSec: number,
): CommentMarker[] {
  if (durationSec <= 0) {
    return comments.map((c) => ({ id: c.id, leftPct: 0 }));
  }
  return comments.map((c) => ({
    id: c.id,
    leftPct: clamp((c.at / durationSec) * 100, 0, 100),
  }));
}

export function rawCommentToVisible(
  raw: RawComment,
  ctx: { producerName: string; now?: Date },
): VisibleComment {
  const mine = raw.fromProducer;
  let who: string;
  let initials: string;
  if (mine) {
    who = ctx.producerName;
    initials = initialsOf(ctx.producerName);
  } else if (raw.authorEmail) {
    const local = raw.authorEmail.split("@")[0] ?? "Artist";
    who = local;
    initials = initialsOf(local).slice(0, 2).toUpperCase();
  } else {
    who = "Artist";
    initials = "AR";
  }

  const when = ctx.now
    ? relTimeWithNow(raw.createdAt, ctx.now)
    : relTime(raw.createdAt);

  return {
    id: raw.id,
    at: Math.round(raw.timestampMs / 1000),
    text: raw.body,
    who,
    initials,
    when,
    mine,
  };
}

function relTimeWithNow(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  const min = Math.floor(diffMs / 60_000);
  const hr = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${String(min)}m ago`;
  if (hr < 24) return `${String(hr)}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${String(days)}d ago`;
  if (days < 30) return `${String(Math.floor(days / 7))}w ago`;
  return `${String(Math.floor(days / 30))}mo ago`;
}
