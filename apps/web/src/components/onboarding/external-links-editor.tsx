"use client";

import { Input, Label } from "~/components/ui/input";
import { cn } from "~/lib/cn";

// Story 06 — Onboarding portfolio external-links editor.
//
// Renders 3 platform inputs (Spotify / YouTube / Instagram). All 3
// are optional; lenient http(s)-prefix validation; on save, the parent
// hands the form state to toLinksPayload() and forwards the result to
// the saveExternalLinks server action.
//
// Why a controlled component: the parent (Step 4 page in Story 08)
// needs to disable Continue while a save is in flight + decide between
// Continue (save) and Skip (don't save). Keeping state up makes that
// trivial. The parent can also pre-seed `value` from the producer's
// existing links if they re-enter the wizard mid-flow.
//
// The repo runs vitest in `node` env (no jsdom) so the contract of
// this file is pinned by exporting the pure helpers (PORTFOLIO_PLATFORMS,
// isValidLinkUrl, linkRowError, toLinksPayload) — same convention as
// Story 02's progress-bar.tsx + action-bar.tsx. The React shell is
// intentionally thin: 3 <Input>s wired to onChange + an inline error
// badge driven by linkRowError.

// ─── Types & enum ───────────────────────────────────────────────────

/**
 * The 3 platform keys exposed by the onboarding portfolio step. The
 * canonical DB enum (schema.ts:767) has 7 values; we only surface
 * Spotify / YouTube / Instagram during onboarding because (a) those
 * are the platforms 95%+ of producers list first, (b) any additional
 * platform can be added later in Setup → Portfolio. The wire-format
 * value 'instagram_reels' (NOT 'instagram') matches the DB enum
 * verbatim — typing it differently would BAD_REQUEST at the action.
 */
export type PortfolioPlatformKey = "spotify" | "youtube" | "instagram_reels";

export type ExternalLinksFormState = Record<PortfolioPlatformKey, string>;

/**
 * Producer-facing metadata for each onboarding-exposed platform.
 * Order = render order (Spotify first because it's the highest-signal
 * artist URL for music producers).
 */
export const PORTFOLIO_PLATFORMS: ReadonlyArray<{
  key: PortfolioPlatformKey;
  label: string;
  placeholder: string;
}> = [
  {
    key: "spotify",
    label: "Spotify",
    placeholder: "https://open.spotify.com/artist/…",
  },
  {
    key: "youtube",
    label: "YouTube",
    placeholder: "https://youtube.com/@yourhandle",
  },
  {
    key: "instagram_reels",
    label: "Instagram",
    placeholder: "https://instagram.com/yourhandle",
  },
];

// ─── Pure helpers (test-pinned) ─────────────────────────────────────

/**
 * Lenient URL check per acceptance criterion 3:
 *   • empty string is valid (means "delete this platform's row")
 *   • whitespace-only is treated as empty
 *   • non-empty must start with http:// or https://
 *   • no other scheme (javascript:, data:, ftp:) accepted
 *
 * Deliberately NOT a strict URL regex — Spotify share links (`?si=`)
 * and Instagram share suffixes legitimately produce edge URLs that a
 * tight regex would reject. The server-side cap at 500 chars is the
 * second guardrail; together they're enough.
 */
export function isValidLinkUrl(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed === "") return true;
  return trimmed.startsWith("https://") || trimmed.startsWith("http://");
}

/**
 * Inline error copy for the UI. null = no error. Producer-facing copy
 * names the http(s):// requirement explicitly so the fix is obvious.
 */
export function linkRowError(input: string): string | null {
  if (isValidLinkUrl(input)) return null;
  return "URL must start with http:// or https://";
}

/**
 * Serialise the editor's form state into the saveExternalLinks
 * input shape. Every platform gets an entry — empty URLs are passed
 * through so the action can DELETE the platform row. Whitespace is
 * trimmed; whitespace-only inputs collapse to "".
 */
export function toLinksPayload(state: ExternalLinksFormState): {
  links: Array<{ platform: PortfolioPlatformKey; url: string }>;
} {
  return {
    links: PORTFOLIO_PLATFORMS.map((p) => ({
      platform: p.key,
      url: state[p.key].trim(),
    })),
  };
}

/**
 * Tailwind class chunk for each platform input. Default Input is
 * h-10 (40 px); we override to min-h-11 (44 px) per CLAUDE.md mobile
 * rule. CSS-vars-only, no hex.
 */
export const EXTERNAL_LINK_INPUT_CLASS = "min-h-11";

// ─── React component ────────────────────────────────────────────────

export interface ExternalLinksEditorProps {
  /** Current form state — controlled by the parent step page. */
  value: ExternalLinksFormState;
  /** Update a single platform's URL. */
  onChange: (key: PortfolioPlatformKey, url: string) => void;
  /** When true, all inputs render disabled (e.g. while save is in flight). */
  disabled?: boolean;
}

/**
 * Empty initial state — useful for the parent step page on first
 * render. Each platform starts with an empty string, which the action
 * treats as "no row to write" (the empty-string DELETE branch is a
 * no-op when there's nothing to delete).
 */
export function emptyExternalLinksState(): ExternalLinksFormState {
  return { spotify: "", youtube: "", instagram_reels: "" };
}

export function ExternalLinksEditor({
  value,
  onChange,
  disabled,
}: ExternalLinksEditorProps) {
  return (
    <div className="flex flex-col gap-5">
      {PORTFOLIO_PLATFORMS.map((p) => {
        const url = value[p.key];
        const err = linkRowError(url);
        const inputId = `onboarding-link-${p.key}`;
        const errId = `${inputId}-error`;
        return (
          <div key={p.key} className="flex flex-col">
            <Label htmlFor={inputId}>{p.label}</Label>
            <Input
              id={inputId}
              type="url"
              inputMode="url"
              autoComplete="url"
              spellCheck={false}
              value={url}
              placeholder={p.placeholder}
              disabled={disabled}
              onChange={(e) => { onChange(p.key, e.currentTarget.value); }}
              aria-invalid={err ? true : undefined}
              aria-describedby={err ? errId : undefined}
              className={cn(EXTERNAL_LINK_INPUT_CLASS)}
            />
            {err ? (
              <p
                id={errId}
                className="mt-1.5 text-xs text-[rgb(var(--fg-danger))]"
              >
                {err}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
