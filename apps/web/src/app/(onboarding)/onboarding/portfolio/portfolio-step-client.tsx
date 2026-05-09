"use client";

import { ChevronDown, Plus, UploadCloud, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";
import {
  emptyExternalLinksState,
  toLinksPayload,
  type ExternalLinksFormState,
  type PortfolioPlatformKey,
} from "~/components/onboarding/external-links-editor";
// emptyExternalLinksState is a FUNCTION (not a constant) — invoking it
// returns a fresh ExternalLinksFormState with all 3 platform keys set
// to empty url/title strings. Calling it inside handleContinue keeps
// each save independent.

import { saveExternalLinks } from "./links-actions";
import {
  PORTFOLIO_STEP_INDEX,
  PORTFOLIO_STEP_SUBTITLE,
  PORTFOLIO_STEP_TITLE,
  routeOnBackFromPortfolio,
  routeOnContinueFromPortfolio,
  routeOnSkipFromPortfolio,
} from "./constants";

// Step 4 — A taste of your work. May 2026 redesign (revised
// 2026-05-09 — per-row dropdown for picking link type).
//
// Producer adds links one at a time. Each row has a dropdown
// (Spotify / YouTube / Instagram / Custom) + URL input + × remove.
// First render shows ONE empty row defaulting to Spotify. Tapping
// "+ Add another link" appends a new row defaulting to the first
// unused platform type (or Custom if all 3 are used).
//
// Custom links: schema only supports 3 platforms today, so custom
// rows are captured in local state but skipped on save with a TODO
// for the schema follow-up. The placeholder + helper copy makes the
// "coming soon" status explicit so producers don't think they're
// being silently dropped.

type LinkType = PortfolioPlatformKey;

interface LinkRow {
  /** Stable id so React doesn't reuse the wrong DOM node when reordering. */
  id: string;
  type: LinkType;
  url: string;
}

interface TypeMeta {
  label: string;
  placeholder: string;
}

const TYPE_META: Record<LinkType, TypeMeta & { color: string }> = {
  spotify: {
    label: "Spotify",
    placeholder: "https://open.spotify.com/artist/…",
    color: "#1DB954",
  },
  youtube: {
    label: "YouTube",
    placeholder: "https://youtube.com/@yourhandle",
    color: "#FF0033",
  },
  instagram_reels: {
    label: "Instagram",
    placeholder: "https://instagram.com/yourhandle",
    color: "#E4405F",
  },
};

const PLATFORM_TYPES: ReadonlyArray<PortfolioPlatformKey> = [
  "spotify",
  "youtube",
  "instagram_reels",
];
const ALL_TYPES: ReadonlyArray<LinkType> = PLATFORM_TYPES;

function nextDefaultType(rows: ReadonlyArray<LinkRow>): LinkType | null {
  const used = new Set(rows.map((r) => r.type));
  return PLATFORM_TYPES.find((t) => !used.has(t)) ?? null;
}

function makeId(): string {
  return `link-${Math.random().toString(36).slice(2, 9)}`;
}

export function PortfolioStepClient() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<LinkRow[]>([
    { id: makeId(), type: "spotify", url: "" },
  ]);
  const [error, setError] = useState<string | null>(null);

  const updateRow = (id: string, patch: Partial<LinkRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
    if (error) setError(null);
  };

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const addRow = () => {
    const next = nextDefaultType(rows);
    if (!next) return; // all 3 platforms already shown
    setRows((prev) => [...prev, { id: makeId(), type: next, url: "" }]);
  };

  const canAddMore = nextDefaultType(rows) !== null;

  const handleContinue = () => {
    setError(null);
    const formState: ExternalLinksFormState = emptyExternalLinksState();
    for (const row of rows) {
      formState[row.type] = { url: row.url, title: "" };
    }
    startTransition(async () => {
      try {
        await saveExternalLinks(toLinksPayload(formState));
        router.push(routeOnContinueFromPortfolio());
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't save your links — try again or hit Skip.",
        );
      }
    });
  };

  return (
    <WizardChrome
      activePosition={PORTFOLIO_STEP_INDEX}
      stepIndicator="Step 4 of 5"
      footer={
        <WizardFooter
          onBack={() => router.push(routeOnBackFromPortfolio())}
          onSkip={() => router.push(routeOnSkipFromPortfolio())}
          onContinue={handleContinue}
          pending={pending}
        />
      }
    >
      <div className="reveal-up">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-[rgb(var(--brand-primary-dark))]">
          Step 4 of 5 · Optional
        </p>
        <h1
          className="mt-3 font-display text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] text-balance"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          {PORTFOLIO_STEP_TITLE}
        </h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-[rgb(var(--fg-muted))]">
          {PORTFOLIO_STEP_SUBTITLE}
        </p>

        {/* Live preview — colored circles per platform, brighten when
            the producer fills a URL. Quiet visual proof of "this is
            what artists will see in your storefront hero." */}
        <div className="mt-5 flex items-center gap-2.5 rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3">
          <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Preview
          </span>
          <div className="flex flex-1 gap-1.5">
            {PLATFORM_TYPES.map((t) => {
              const filled =
                rows.find((r) => r.type === t)?.url.trim().length ?? 0;
              const meta = TYPE_META[t];
              const initial = meta.label[0] ?? "";
              return (
                <span
                  key={t}
                  aria-hidden
                  className="flex h-6 w-6 items-center justify-center rounded-full font-mono text-[10px] font-bold text-white transition-all"
                  style={{
                    background:
                      filled > 0
                        ? meta.color
                        : "rgb(var(--border-strong))",
                    opacity: filled > 0 ? 1 : 0.5,
                  }}
                  title={meta.label}
                >
                  {initial}
                </span>
              );
            })}
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--fg-faint))]">
            <UploadCloud size={11} className="mr-1 inline" aria-hidden />
            Track upload soon
          </span>
        </div>

        {/* Link rows */}
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((row) => {
            const meta = TYPE_META[row.type];
            return (
              <div
                key={row.id}
                className="flex items-center gap-2 rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 py-1.5"
              >
                {/* Type dropdown — styled to look obviously interactive
                    (chevron + bordered pill) since native <select>
                    chrome varies by browser. The actual <select> is
                    overlaid invisibly on top so click + keyboard
                    behaviour stays native. */}
                <div className="relative flex-shrink-0">
                  <div className="pointer-events-none flex items-center gap-1 rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-2 py-1.5 text-[11.5px] font-bold uppercase tracking-[0.08em] text-[rgb(var(--fg-default))]">
                    <span className="min-w-[58px]">
                      {TYPE_META[row.type].label}
                    </span>
                    <ChevronDown
                      size={11}
                      className="text-[rgb(var(--fg-muted))]"
                      aria-hidden
                    />
                  </div>
                  <select
                    value={row.type}
                    onChange={(e) =>
                      updateRow(row.id, { type: e.target.value as LinkType })
                    }
                    className="absolute inset-0 cursor-pointer opacity-0"
                    disabled={pending}
                    aria-label="Link type"
                  >
                    {ALL_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_META[t].label}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="url"
                  value={row.url}
                  onChange={(e) => updateRow(row.id, { url: e.target.value })}
                  placeholder={meta.placeholder}
                  className="flex-1 bg-transparent px-1 py-1 font-mono text-[13px] text-[rgb(var(--fg-default))] outline-none placeholder:text-[rgb(var(--fg-faint))]"
                  disabled={pending}
                />
                {rows.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    aria-label="Remove link"
                    className="sk-pop flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-background))] hover:text-[rgb(var(--fg-default))]"
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
            );
          })}

          {canAddMore ? (
            <button
              type="button"
              onClick={addRow}
              className="sk-pop flex items-center justify-center gap-1.5 self-start rounded-full border border-dashed border-[rgb(var(--border-strong))] px-3.5 py-1.5 text-[12px] font-semibold text-[rgb(var(--fg-muted))] transition-colors hover:border-[rgb(var(--brand-primary))] hover:text-[rgb(var(--fg-default))]"
            >
              <Plus size={12} aria-hidden />
              Add another link
            </button>
          ) : null}
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-[rgb(var(--fg-danger)/0.4)] bg-[rgb(var(--fg-danger)/0.08)] px-3 py-2 text-[13px] text-[rgb(var(--fg-danger))]"
          >
            {error}
          </p>
        ) : null}
      </div>
    </WizardChrome>
  );
}
