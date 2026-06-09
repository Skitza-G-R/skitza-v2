// Types + pure helpers + placeholder data for the artist sessions screens
// (Book section — S10 pick / S11 confirmed + My sessions / S12 cancel).
//
// Every helper here is pure: it takes its `now`/`today` as an argument and
// never reads the runtime clock or randomness inside, so the screens render
// identically on the server and the client (no hydration drift) and the unit
// tests stay deterministic. UTC-safe date parsing mirrors booking-client.tsx
// so SSR and CSR format the same string.
//
// Shapes mirror Raz's BE-3 contract (SK-39): the producer's real sessions +
// availability arrive through the same fields, so the route page.tsx swaps
// MOCK_* for the tRPC caller and the screens don't change.

import {
  coverGradient,
  formatShekels,
  type Producer,
  MOCK_PRODUCER as PURCHASE_MOCK_PRODUCER,
  swatchGradient,
} from "../purchase/purchase-data";

// Re-export the shared store primitives so the sessions screens import from
// one place (no duplicate gradient/format logic).
export { coverGradient, formatShekels, swatchGradient };
export type { Producer };

const HOUR_MS = 3_600_000;

// ── Session-progress display ──────────────────────────────────────────
// How to show "sessions used of total" for an active booking. A short
// package reads as dots; a long one as a bar; an open-ended one as a count.

export type ProgressMode = "dots" | "bar" | "count";

export function progressMode(total: number | null): ProgressMode {
  if (total === null) return "count";
  if (total <= 6) return "dots";
  return "bar";
}

// One entry per session in the package; the first `used` are filled. Clamped
// defensively so a bad count never renders more (or negative) filled dots.
export function buildProgressDots(used: number, total: number): { filled: boolean }[] {
  const safeUsed = Math.min(Math.max(used, 0), total);
  return Array.from({ length: total }, (_v, i) => ({ filled: i < safeUsed }));
}

// ── Cancel / reschedule policy (S12) ──────────────────────────────────
// The time-policy gates the ACTION only, not money. `withinPolicy` is true
// when the session is at least `windowHours` away. `nowMs` is injected.

export function cancelPolicy(
  startsAtMs: number,
  windowHours: number,
  nowMs: number,
  producerName: string,
): { withinPolicy: boolean; hoursUntil: number; reason: string | null } {
  const withinPolicy = startsAtMs - nowMs >= windowHours * HOUR_MS;
  const hoursUntil = Math.max(0, Math.floor((startsAtMs - nowMs) / HOUR_MS));
  const reason = withinPolicy
    ? null
    : "Too close to the session — message " + producerName + " to change it.";
  return { withinPolicy, hoursUntil, reason };
}

// ── Primary booking-action label (S10) ────────────────────────────────
// Gate 3 (session approval) is a producer toggle, default ON. When on, the
// slot is held pending approval ("Request"); when off it books instantly.

export function bookingActionLabel(gate3On: boolean): "Request this slot" | "Book this slot" {
  return gate3On ? "Request this slot" : "Book this slot";
}

// ── UTC-safe session date/time formatting ─────────────────────────────
// Parse the full ISO instant and format in UTC so the server and client
// agree (mirrors booking-client.tsx's `timeZone: "UTC"` date math). Single
// timezone (Israel) in v1; the instant is the source of truth.

export function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatSessionTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });
}

// ── Domain types ──────────────────────────────────────────────────────

export type SessionStatus = "confirmed" | "held" | "done";

export type SessionListItem = {
  id: string;
  startsAtISO: string;
  durationMin: number;
  productName: string;
  producerName: string;
  status: SessionStatus;
};

export type ActiveBooking = {
  productName: string;
  sessionsUsed: number;
  sessionsTotal: number | null;
  canBookAnother: boolean;
};

export type SessionDetail = {
  id: string;
  startsAtISO: string;
  startsAtMs: number;
  durationMin: number;
  productName: string;
  status: SessionStatus;
};

// ── Placeholder content ───────────────────────────────────────────────
// MOCK — BE-3 (SK-39) will provide artist.book.mySessions / artist.book.session;
// swap MOCK_* for the tRPC caller in page.tsx, screens unchanged.
// Fixed ISO strings + fixed epoch-ms literals only — no runtime clock here.

export const MOCK_PRODUCER: Producer = PURCHASE_MOCK_PRODUCER;

export const MOCK_SESSIONS: SessionListItem[] = [
  {
    id: "ses_01",
    startsAtISO: "2026-06-12T15:00:00.000Z",
    durationMin: 120,
    productName: "Single — start to finish",
    producerName: MOCK_PRODUCER.name,
    status: "held",
  },
  {
    id: "ses_02",
    startsAtISO: "2026-06-18T11:00:00.000Z",
    durationMin: 120,
    productName: "Single — start to finish",
    producerName: MOCK_PRODUCER.name,
    status: "confirmed",
  },
  {
    id: "ses_03",
    startsAtISO: "2026-06-25T17:00:00.000Z",
    durationMin: 120,
    productName: "Single — start to finish",
    producerName: MOCK_PRODUCER.name,
    status: "confirmed",
  },
  {
    id: "ses_04",
    startsAtISO: "2026-05-28T13:00:00.000Z",
    durationMin: 120,
    productName: "Single — start to finish",
    producerName: MOCK_PRODUCER.name,
    status: "done",
  },
];

export const MOCK_ACTIVE_BOOKING: ActiveBooking = {
  productName: "Single — start to finish",
  sessionsUsed: 1,
  sessionsTotal: 4,
  canBookAnother: true,
};

export const MOCK_SESSION_DETAIL: SessionDetail = {
  id: "ses_02",
  startsAtISO: "2026-06-18T11:00:00.000Z",
  startsAtMs: 1781780400000,
  durationMin: 120,
  productName: "Single — start to finish",
  status: "confirmed",
};

export const MOCK_CANCEL_WINDOW_HOURS = 24;
