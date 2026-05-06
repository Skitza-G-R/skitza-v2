"use client";

// Marketing meta editor — 4 fields that surface on the producer's
// public /join/<slug> page in the 4-stat band right under the hero
// (Genres / Released / Streams / Response).
//
// Per PRD v3 §4.6 "Settings has 2 branches only: Profile and
// Integrations" — and image/branding/identity all live under Profile,
// so this section sits in the Profile branch alongside studio profile
// + brand + portfolio.
//
// Behavior:
//   * Genres: chip editor — type a tag and press Enter (or comma) to
//     commit; click X on a chip to remove. Capped at 8 tags. Lowercase
//     tags display title-cased on the public page (the formatter on
//     the strip side handles casing — we store what the producer
//     typed, trimmed).
//   * Released / Streams: short text inputs (max 80 chars).
//   * Response: select with the 3 dropdown presets + "Hidden".
//   * "Hidden" maps to `null` on responseHours and the public strip
//     drops the entire stat block.
//   * Single Save button — minimal patch on the wire (only changed
//     fields are shipped). Mirrors the SettingsForm convention.

import { type SyntheticEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Input, Label, Select } from "~/components/ui/input";
import { SaveIndicator, useSaveStatus } from "~/components/ui/save-indicator";
import { useToast } from "~/components/ui/toast";
import { updateMarketing } from "~/app/(producer)/dashboard/settings/actions";

// Shape exposed by `producer.me().marketing`. Mirrored on the prop
// type so the parent server component can pass the row straight
// through without remapping.
export interface MarketingProfile {
  genres: string[] | null;
  releasedSummary: string | null;
  streamsSummary: string | null;
  responseHours: number | null;
}

const MAX_GENRES = 8;
const MAX_GENRE_CHARS = 32;
const MAX_SUMMARY_CHARS = 80;

// Match the responseHours zod enum on the server. "0" sentinel value
// in the <select> represents the Hidden option since HTML select values
// are strings; we map it back to `null` before submit.
const RESPONSE_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: 24, label: "Within 24h" },
  { value: 48, label: "Within 48h" },
  { value: 168, label: "Within 1 week" },
  { value: null, label: "Hidden" },
];

export function MarketingSection({
  profile,
}: {
  profile: MarketingProfile;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const saveStatus = useSaveStatus({ saving: pending, error });

  const [genres, setGenres] = useState<string[]>(profile.genres ?? []);
  const [genreDraft, setGenreDraft] = useState("");
  const [releasedSummary, setReleasedSummary] = useState(
    profile.releasedSummary ?? "",
  );
  const [streamsSummary, setStreamsSummary] = useState(
    profile.streamsSummary ?? "",
  );
  const [responseHours, setResponseHours] = useState<number | null>(
    profile.responseHours,
  );

  // Add a tag from the draft input — split on comma so a producer can
  // paste "indie, alt-pop, electronic" and get 3 chips. Empty entries
  // are dropped. Duplicates (case-insensitive) skip.
  function commitGenreDraft() {
    const fragments = genreDraft
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= MAX_GENRE_CHARS);
    if (fragments.length === 0) {
      setGenreDraft("");
      return;
    }
    const lowerExisting = new Set(genres.map((g) => g.toLowerCase()));
    const next = [...genres];
    for (const f of fragments) {
      if (next.length >= MAX_GENRES) break;
      if (lowerExisting.has(f.toLowerCase())) continue;
      next.push(f);
      lowerExisting.add(f.toLowerCase());
    }
    setGenres(next);
    setGenreDraft("");
  }

  function removeGenre(index: number) {
    setGenres((prev) => prev.filter((_, i) => i !== index));
  }

  // Compute the minimal patch to ship — same convention as SettingsForm.
  // We only include a field if the user actually changed it. For arrays
  // we compare by stringify since order matters here (chips order is
  // visible to the user).
  const patch = useMemo(() => {
    const out: Parameters<typeof updateMarketing>[0] = {};
    const cleanGenres = genres
      .map((g) => g.trim())
      .filter((g) => g.length > 0);
    const startGenres = profile.genres ?? [];
    if (JSON.stringify(cleanGenres) !== JSON.stringify(startGenres)) {
      out.genres = cleanGenres.length === 0 ? null : cleanGenres;
    }
    if ((releasedSummary.trim() || null) !== (profile.releasedSummary ?? null)) {
      out.releasedSummary = releasedSummary.trim() || null;
    }
    if ((streamsSummary.trim() || null) !== (profile.streamsSummary ?? null)) {
      out.streamsSummary = streamsSummary.trim() || null;
    }
    if (responseHours !== profile.responseHours) {
      // Narrow the value to the zod-validated set the server expects.
      out.responseHours =
        responseHours === 24 || responseHours === 48 || responseHours === 168
          ? responseHours
          : null;
    }
    return out;
  }, [genres, releasedSummary, streamsSummary, responseHours, profile]);

  const dirty = Object.keys(patch).length > 0;

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!dirty) return;
    startTransition(async () => {
      const res = await updateMarketing(patch);
      if (res.ok) {
        toast("Public profile saved.", "success");
        router.refresh();
      } else {
        setError(res.error);
        toast(res.error, "error");
      }
    });
  }

  return (
    <section aria-labelledby="settings-marketing-heading">
      <header className="mb-3">
        <h2
          id="settings-marketing-heading"
          className="font-display text-base tracking-tight"
          style={{ fontWeight: 700 }}
        >
          Public profile copy
        </h2>
        <p className="mt-0.5 text-xs text-[rgb(var(--fg-secondary))]">
          The 4 stats under your hero on{" "}
          <span className="font-mono">/join/&lt;slug&gt;</span>. Each field is
          optional — leave blank to hide that stat.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5">
        {/* Genres — chip editor */}
        <div>
          <Label htmlFor="marketing-genre-input">Genres</Label>
          <div
            className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 py-1.5 transition-colors focus-within:border-[rgb(var(--brand-primary))] focus-within:shadow-[0_0_0_3px_rgb(var(--brand-primary)/0.15)] hover:border-[rgb(var(--border-strong))]"
            onClick={() =>
              document.getElementById("marketing-genre-input")?.focus()
            }
          >
            {genres.map((g, idx) => (
              <span
                key={`${g}-${String(idx)}`}
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[rgb(var(--bg-overlay))] px-2 py-0.5 text-[12px] text-[rgb(var(--fg-primary))]"
              >
                {g}
                <button
                  type="button"
                  onClick={() => {
                    removeGenre(idx);
                  }}
                  className="-mr-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--border-subtle))] hover:text-[rgb(var(--fg-primary))]"
                  aria-label={`Remove ${g}`}
                >
                  <span aria-hidden>×</span>
                </button>
              </span>
            ))}
            <input
              id="marketing-genre-input"
              type="text"
              value={genreDraft}
              onChange={(e) => {
                setGenreDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  commitGenreDraft();
                } else if (
                  e.key === "Backspace" &&
                  genreDraft.length === 0 &&
                  genres.length > 0
                ) {
                  removeGenre(genres.length - 1);
                }
              }}
              onBlur={() => {
                if (genreDraft.length > 0) commitGenreDraft();
              }}
              placeholder={
                genres.length === 0
                  ? "indie, alt-pop, electronic"
                  : genres.length >= MAX_GENRES
                    ? "Maximum reached"
                    : "Add a tag…"
              }
              maxLength={MAX_GENRE_CHARS}
              disabled={genres.length >= MAX_GENRES}
              className="min-w-[10ch] flex-1 bg-transparent px-1 text-[13px] text-[rgb(var(--fg-default))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              aria-describedby="marketing-genre-hint"
            />
          </div>
          <p
            id="marketing-genre-hint"
            className="mt-1.5 text-[11px] text-[rgb(var(--fg-muted))]"
          >
            Press Enter or comma to add. Up to {String(MAX_GENRES)} tags.
          </p>
        </div>

        {/* Released summary */}
        <div>
          <Label htmlFor="marketing-released">Released</Label>
          <Input
            id="marketing-released"
            type="text"
            value={releasedSummary}
            onChange={(e) => {
              setReleasedSummary(e.target.value);
            }}
            placeholder="Multiple records"
            maxLength={MAX_SUMMARY_CHARS}
          />
          <p className="mt-1.5 text-[11px] text-[rgb(var(--fg-muted))]">
            Short freeform — what kind of catalog you have.
          </p>
        </div>

        {/* Streams summary */}
        <div>
          <Label htmlFor="marketing-streams">Streams</Label>
          <Input
            id="marketing-streams"
            type="text"
            value={streamsSummary}
            onChange={(e) => {
              setStreamsSummary(e.target.value);
            }}
            placeholder="On Spotify, Apple, YouTube"
            maxLength={MAX_SUMMARY_CHARS}
          />
          <p className="mt-1.5 text-[11px] text-[rgb(var(--fg-muted))]">
            Where listeners can find your work. Free text — not a real-streams
            count.
          </p>
        </div>

        {/* Response time picker */}
        <div>
          <Label htmlFor="marketing-response">Response time</Label>
          <Select
            id="marketing-response"
            value={responseHours === null ? "hidden" : String(responseHours)}
            onChange={(e) => {
              const v = e.target.value;
              setResponseHours(v === "hidden" ? null : Number(v));
            }}
          >
            {RESPONSE_OPTIONS.map((opt) => (
              <option
                key={opt.value === null ? "hidden" : String(opt.value)}
                value={opt.value === null ? "hidden" : String(opt.value)}
              >
                {opt.label}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-[11px] text-[rgb(var(--fg-muted))]">
            How fast you typically reply to a new lead. Pick Hidden to drop
            this stat.
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-[rgb(var(--fg-danger))]">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <p className="font-mono text-xs text-[rgb(var(--fg-muted))]">
              {dirty
                ? `${String(Object.keys(patch).length)} unsaved change${
                    Object.keys(patch).length === 1 ? "" : "s"
                  }`
                : "No changes"}
            </p>
            {error ? (
              <SaveIndicator status={saveStatus} errorMessage={error} />
            ) : (
              <SaveIndicator status={saveStatus} />
            )}
          </div>
          <Button type="submit" disabled={pending || !dirty}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </section>
  );
}
