"use client";

import type { ReactNode } from "react";

// Inline form validation primitives — shared so every form surfaces
// the same field-state vocabulary. "As-you-type" instead of "on-submit
// only" means producers see a green tick the moment their email is
// well-formed, a red dot the moment it isn't, and a "Required" hint
// if they moved past an empty field.
//
// Field-level state is a tiny union: `idle` (user hasn't touched it),
// `pending` (async check in flight, e.g. slug availability), `valid`
// (well-formed), `invalid` (has an error message), and `required`
// (touched + blank). The renderer picks a colour + glyph + optional
// message from that state.

export type ValidationState =
  | { kind: "idle" }
  | { kind: "pending"; message?: string }
  | { kind: "valid"; message?: string }
  | { kind: "invalid"; message: string }
  | { kind: "required" };

export function ValidationHint({
  state,
  hint,
}: {
  state: ValidationState;
  /** Neutral helper text shown when the field is idle (pre-interaction). */
  hint?: ReactNode;
}) {
  if (state.kind === "idle") {
    if (!hint) return null;
    return (
      <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">{hint}</p>
    );
  }
  if (state.kind === "pending") {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[rgb(var(--fg-muted))]">
        <span
          aria-hidden
          className="inline-block h-2 w-2 animate-pulse rounded-full bg-[rgb(var(--fg-muted))]"
        />
        <span>{state.message ?? "Checking…"}</span>
      </p>
    );
  }
  if (state.kind === "valid") {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[rgb(var(--fg-success,16_185_129))]">
        <CheckGlyph />
        <span>{state.message ?? "Looks good"}</span>
      </p>
    );
  }
  if (state.kind === "invalid") {
    return (
      <p
        role="alert"
        aria-live="polite"
        className="mt-1.5 flex items-center gap-1.5 text-xs text-[rgb(var(--fg-danger))]"
      >
        <DotGlyph />
        <span>{state.message}</span>
      </p>
    );
  }
  // required
  return (
    <p
      role="alert"
      aria-live="polite"
      className="mt-1.5 flex items-center gap-1.5 text-xs text-[rgb(var(--fg-danger))]"
    >
      <DotGlyph />
      <span>Required</span>
    </p>
  );
}

// Mini inline badges that can sit INSIDE the input's trailing slot.
// We use these on the slug field to surface "taken" / "available".
export function ValidationBadge({ state }: { state: ValidationState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "pending") {
    return (
      <span
        aria-hidden
        className="inline-flex h-4 w-4 items-center justify-center"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-[rgb(var(--fg-muted))]" />
      </span>
    );
  }
  if (state.kind === "valid") {
    return (
      <span className="inline-flex h-4 w-4 items-center justify-center text-[rgb(var(--fg-success,16_185_129))]">
        <CheckGlyph />
      </span>
    );
  }
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center text-[rgb(var(--fg-danger))]">
      <DotGlyph />
    </span>
  );
}

// ── Validation helpers (pure, testable) ─────────────────────────────

// RFC-5322-lite. Matches the Stripe / HTML spec shape: local@domain.tld
// with sensible character classes. Good enough for UX feedback; the
// server remains source of truth on actual deliverability.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(v: string): boolean {
  const t = v.trim();
  if (t.length === 0 || t.length > 254) return false;
  return EMAIL_RE.test(t);
}

// Slug: lowercase letters, digits, dashes. 3-48 chars. Matches the
// server contract in producer.update's zod schema.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateSlug(v: string): ValidationState {
  const t = v.trim();
  if (t.length === 0) return { kind: "required" };
  if (t.length < 3) return { kind: "invalid", message: "At least 3 characters" };
  if (t.length > 48) return { kind: "invalid", message: "At most 48 characters" };
  if (!SLUG_RE.test(t)) {
    return {
      kind: "invalid",
      message: "Lowercase letters, numbers, and single dashes only",
    };
  }
  return { kind: "valid", message: "Available shape" };
}

// Validate a user-facing display name. We don't force a specific shape
// beyond "non-empty after trim" + a reasonable upper bound; the server
// clamps too, but the client-side hint keeps producers from typing a
// 200-char name then hitting a generic "too long" on submit.
export function validateDisplayName(v: string): ValidationState {
  const t = v.trim();
  if (t.length === 0) return { kind: "required" };
  if (t.length > 80) return { kind: "invalid", message: "At most 80 characters" };
  return { kind: "valid" };
}

export function validateEmail(v: string): ValidationState {
  const t = v.trim();
  if (t.length === 0) return { kind: "required" };
  if (!isValidEmail(t)) return { kind: "invalid", message: "Doesn't look like an email" };
  return { kind: "valid" };
}

// Numeric parse + range feedback. `formatParsed` lets callers surface
// "e.g. 60 minutes" or "$150.00" in the helper text; we keep the
// helper pure so it can be unit tested without i18n wiring.
export function validateNumber(
  v: number | string,
  opts: { min?: number; max?: number; label?: string; formatParsed?: (n: number) => string },
): ValidationState {
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return { kind: "invalid", message: "Must be a number" };
  if (opts.min !== undefined && n < opts.min)
    return {
      kind: "invalid",
      message: `Minimum ${String(opts.min)}${opts.label ? ` ${opts.label}` : ""}`,
    };
  if (opts.max !== undefined && n > opts.max)
    return {
      kind: "invalid",
      message: `Maximum ${String(opts.max)}${opts.label ? ` ${opts.label}` : ""}`,
    };
  if (opts.formatParsed) {
    return { kind: "valid", message: opts.formatParsed(n) };
  }
  return { kind: "valid" };
}

// ── Glyphs ──────────────────────────────────────────────────────────

function CheckGlyph() {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 6.2l2.3 2.3L9.5 3.5" />
    </svg>
  );
}

function DotGlyph() {
  return (
    <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <circle cx="5" cy="5" r="4" />
    </svg>
  );
}
