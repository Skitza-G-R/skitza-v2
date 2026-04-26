// Pure helpers for the Project Dashboard tab (Story 04 — PRD §11.5).
//
// Why a separate module: the .tsx component files are mostly markup +
// the small amount of logic they touch (mm:ss formatting, event copy,
// the morphing CTA table). Isolating the logic here lets us unit-test
// each branch without rendering React, which the repo doesn't have
// jsdom + RTL set up for. See dashboard-helpers.test.ts for the
// per-helper coverage.

import type { Stage } from "~/lib/projects/stages";

// ─── Re-exported types — mirror projectRoom.dashboard return shape ──
//
// The procedure's return shape (apps/web/src/server/trpc/routers/
// project-room.ts) is the authoritative type. We re-declare the
// loose-typed pieces we need (ActivityEvent, WhatsNextSignal) so the
// component files can consume them without importing TRPCRouter
// inference plumbing throughout the tree.

export type ActivityKind =
  | "version_uploaded"
  | "comment_posted"
  | "comment_resolved"
  | "session_booked"
  | "session_confirmed"
  | "session_cancelled"
  | "invoice_sent"
  | "invoice_paid"
  | "contract_signed";

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

export type WhatsNextSignal =
  | { kind: "send_contract"; payload: { contractId: string | null } }
  | {
      kind: "unpaid_invoice";
      payload: {
        invoiceId: string;
        amountCents: number;
        currency: string;
      };
    }
  | {
      kind: "upcoming_session";
      payload: { bookingId: string; startsAt: Date };
    }
  | {
      kind: "unread_comment";
      payload: { commentId: string; trackId: string };
    }
  | {
      kind: "awaiting_review";
      payload: { versionId: string; sentAt: Date };
    };

// ─── formatTimestamp — mm:ss for comment anchors ────────────────────
// Used by:
//   - OpenCommentsList (per-row "0:42" anchor)
//   - the eventual MusicSubTab waveform overlay
// Defensive against negative ms (clamps to 0). Never returns "0h0m" or
// "01:02:05" — comments on hour-long stems are rare; we'd rather show
// "62:05" than confuse the producer with a 3-segment timestamp.
export function formatTimestamp(ms: number): string {
  const safe = Math.max(0, ms);
  const totalSec = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const ss = seconds.toString().padStart(2, "0");
  return `${minutes.toString()}:${ss}`;
}

// ─── truncateBody — body preview with ellipsis ──────────────────────
// Strips trailing whitespace before adding the ellipsis so we don't
// render "abc <space>…" — reads as "abc…" instead. Default 80 chars
// matches the OpenCommentsList preview length.
export function truncateBody(body: string, max = 80): string {
  if (body.length <= max) return body;
  const sliced = body.slice(0, max).replace(/\s+$/, "");
  return `${sliced}…`;
}

// ─── pickHeaderCta — morphing CTA per stage ─────────────────────────
//
// PRD §11.5 names 5 CTA categories (lead / trial / in_progress / final
// / paid). The live DB stage enum has 9 values; we collapse:
//
//   lead                      → "Approve & invoice deposit"
//   booked, contract_sent     → "Send V1 for review"   (trial bucket)
//   in_production             → "Send next version"
//   final_review              → "Mark final & invoice"
//   paid                      → "Archive"              (secondary)
//   archived                  → null  (already terminal)
//   cancelled, payment_paused → null  (no forward CTA — wait/recover)
//
// `intent` lets the button tune its visual weight: primary stages get
// a brand-coloured CTA; the paid → archive transition is secondary
// since the project is effectively done.
export type HeaderCta = {
  label: string;
  intent: "primary" | "secondary";
};

export function pickHeaderCta(stage: Stage): HeaderCta | null {
  switch (stage) {
    case "lead":
      return { label: "Approve & invoice deposit", intent: "primary" };
    case "booked":
    case "contract_sent":
      return { label: "Send V1 for review", intent: "primary" };
    case "in_production":
      return { label: "Send next version", intent: "primary" };
    case "final_review":
      return { label: "Mark final & invoice", intent: "primary" };
    case "paid":
      return { label: "Archive", intent: "secondary" };
    case "archived":
    case "cancelled":
    case "payment_paused":
      return null;
  }
}

// ─── selectVisibleEvents — collapsed-history slice ──────────────────
// Linear-style: 5 most-recent events visible by default; "Show
// earlier" toggles to expanded which reveals the full list. The
// procedure already DESC-sorts events by occurredAt + slices to 10,
// so the input here is at most 10 items.
export const COLLAPSED_HISTORY_LIMIT = 5;

export function selectVisibleEvents(
  events: ActivityEvent[],
  expanded: boolean,
): ActivityEvent[] {
  if (expanded) return events;
  return events.slice(0, COLLAPSED_HISTORY_LIMIT);
}

// ─── describeActivityEvent — per-kind one-line summary ──────────────
// Renders a single line per event in the activity feed. Each kind
// returns:
//   - label: the visible string ("V2 · Sunshine", "Maya commented")
//   - intent: optional dot colour for the timeline rail
//
// We deliberately keep the strings short — the feed is meant to be
// scannable, not exhaustive. Producers click into Music / Money / etc.
// for the full context.
export type ActivityIntent =
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "neutral";

export interface ActivityLine {
  label: string;
  intent: ActivityIntent;
}

// Narrow a payload field to a string. The procedure populates these
// from typed columns (text / varchar) but the union widened to
// Record<string, unknown> at the ActivityEvent boundary, so we re-
// narrow defensively here. Returns the fallback when the value isn't
// a string.
function payloadStr(
  payload: Record<string, unknown>,
  key: string,
  fallback = "",
): string {
  const v = payload[key];
  return typeof v === "string" ? v : fallback;
}

function payloadNum(
  payload: Record<string, unknown>,
  key: string,
  fallback = 0,
): number {
  const v = payload[key];
  return typeof v === "number" ? v : fallback;
}

export function describeActivityEvent(event: ActivityEvent): ActivityLine {
  switch (event.kind) {
    case "version_uploaded": {
      const label = payloadStr(event.payload, "label");
      const trackTitle = payloadStr(event.payload, "trackTitle");
      const parts = [label, trackTitle].filter((s) => s.length > 0);
      return {
        label:
          parts.length > 0
            ? `New version ${parts.join(" · ")}`
            : "New version",
        intent: "info",
      };
    }
    case "comment_posted": {
      const fromProducer = Boolean(event.payload.fromProducer);
      const author = payloadStr(event.payload, "authorName", "Artist");
      const preview = payloadStr(event.payload, "preview");
      const who = fromProducer ? "You" : author;
      return {
        label: preview.length > 0 ? `${who} commented · ${preview}` : `${who} commented`,
        intent: fromProducer ? "neutral" : "info",
      };
    }
    case "comment_resolved":
      return { label: "Comment resolved", intent: "success" };
    case "session_booked":
      return { label: "Session booked", intent: "info" };
    case "session_confirmed":
      return { label: "Session confirmed", intent: "success" };
    case "session_cancelled":
      return { label: "Session cancelled", intent: "danger" };
    case "invoice_sent": {
      const amt = payloadNum(event.payload, "amountCents");
      const cur = payloadStr(event.payload, "currency", "USD");
      return {
        label: `Invoice sent · ${formatMoney(amt, cur)}`,
        intent: "info",
      };
    }
    case "invoice_paid": {
      const amt = payloadNum(event.payload, "amountCents");
      const cur = payloadStr(event.payload, "currency", "USD");
      return {
        label: `Invoice paid · ${formatMoney(amt, cur)}`,
        intent: "success",
      };
    }
    case "contract_signed":
      return { label: "Contract signed", intent: "success" };
  }
}

// ─── buildWhatsNextLine — render the "what's next" signal ───────────
// The procedure already runs the precedence ladder (PRD §11.5 step 3)
// and returns the winner as a discriminated union. We just map each
// kind to its display copy + an optional jump URL.
export interface WhatsNextLine {
  label: string;
  intent: "primary" | "warning" | "danger";
}

export function buildWhatsNextLine(
  signal: WhatsNextSignal | null,
  now: Date = new Date(),
): WhatsNextLine | null {
  if (!signal) return null;
  switch (signal.kind) {
    case "send_contract":
      return {
        label: "Send contract for signature",
        intent: "warning",
      };
    case "unpaid_invoice":
      return {
        label: `Invoice ${formatMoney(signal.payload.amountCents, signal.payload.currency)} · awaiting payment`,
        intent: "danger",
      };
    case "upcoming_session": {
      const startsAt = new Date(signal.payload.startsAt);
      const dayHourMin = new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      }).format(startsAt);
      void now;
      return {
        label: `Session ${dayHourMin}`,
        intent: "primary",
      };
    }
    case "unread_comment":
      return {
        label: "New comment from artist",
        intent: "primary",
      };
    case "awaiting_review":
      return {
        label: "Awaiting artist feedback",
        intent: "primary",
      };
  }
}

// ─── buildVersionJumpHref ───────────────────────────────────────────
// The latest-version strip's title is a Link to Music tab + scroll-to
// the version. The Music tab consumes the searchParams to highlight
// the matching row.
export function buildVersionJumpHref(args: {
  projectId: string;
  versionId: string;
}): string {
  const sp = new URLSearchParams();
  sp.set("tab", "music");
  sp.set("versionId", args.versionId);
  return `/dashboard/projects/${args.projectId}?${sp.toString()}`;
}

// ─── buildCommentJumpHref ───────────────────────────────────────────
// Open-comment row click → Music tab + scroll-to the comment + open
// the thread.
export function buildCommentJumpHref(args: {
  projectId: string;
  versionId: string;
  commentId: string;
}): string {
  const sp = new URLSearchParams();
  sp.set("tab", "music");
  sp.set("versionId", args.versionId);
  sp.set("commentId", args.commentId);
  return `/dashboard/projects/${args.projectId}?${sp.toString()}`;
}

// ─── formatFileSize — bytes → "5.3 MB" for the meta sidebar ─────────
// Uses 1024-based prefixes (KiB / MiB / GiB) but renders SI labels
// because that's what users expect from a file system. Matches the
// convention used in the artist-side library.
export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${String(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${String(Math.round(kb))} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

// ─── formatMoney — currency formatter (pure helper, no Intl side-effects) ──
// Matches the existing formatter in money-sub-tab.tsx — same options,
// same locale ("en-US" for stable test snapshots vs the user's local
// formatting). The ledger-side formatters can switch to undefined
// locale at the page boundary; here we want "$500" not "US$500".
export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
