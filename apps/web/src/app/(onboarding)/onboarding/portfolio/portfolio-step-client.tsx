"use client";

import { ChevronDown, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { WizardFooter } from "~/components/onboarding/wizard-shell/wizard-footer";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";

import { saveExternalLinks } from "./links-actions";
import {
  PORTFOLIO_STEP_INDEX,
  PORTFOLIO_STEP_SUBTITLE,
  PORTFOLIO_STEP_TITLE,
  routeOnBackFromPortfolio,
  routeOnContinueFromPortfolio,
  routeOnSkipFromPortfolio,
} from "./constants";
import {
  initialPortfolioRows,
  nextAvailablePortfolioPlatform,
  onboardingPortfolioUrlError,
  ONBOARDING_PORTFOLIO_PLATFORMS,
  PORTFOLIO_PLATFORM_META,
  toOnboardingPortfolioPayload,
  type InitialPortfolioLink,
  type OnboardingPortfolioPlatform,
  type PortfolioLinkRow,
} from "./portfolio-links";

// Producer adds links one at a time. Each row has a dropdown
// (Spotify / YouTube / Instagram / SoundCloud / Bandcamp) + URL
// input + × remove. The three core choices are always initialized;
// saved SoundCloud and Bandcamp links are restored on re-entry.

export function PortfolioStepClient({
  initialLinks = [],
  previewMode = false,
}: {
  initialLinks?: readonly InitialPortfolioLink[];
  previewMode?: boolean;
}) {
  const router = useRouter();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<PortfolioLinkRow[]>(() => initialPortfolioRows(initialLinks));
  const [error, setError] = useState<string | null>(null);

  const updateRow = (id: string, patch: Partial<PortfolioLinkRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    if (error) setError(null);
  };

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const addRow = () => {
    const next = nextAvailablePortfolioPlatform(rows);
    if (!next) return;
    setRows((prev) => [...prev, { id: `link-${next}`, type: next, url: "", title: "" }]);
  };

  const canAddMore = nextAvailablePortfolioPlatform(rows) !== null;

  const handleContinue = () => {
    setError(null);
    const invalidLink = rows
      .map((row) => onboardingPortfolioUrlError(row.type, row.url))
      .find((message): message is string => message !== null);
    if (invalidLink) {
      setError(invalidLink);
      return;
    }
    if (previewMode) {
      router.push(routeOnContinueFromPortfolio(true));
      return;
    }
    if (!online) {
      setError("Reconnect to save your portfolio links.");
      return;
    }
    startTransition(async () => {
      try {
        await saveExternalLinks(toOnboardingPortfolioPayload(rows));
        router.push(routeOnContinueFromPortfolio(false));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't save your links — try again or hit Skip.",
        );
      }
    });
  };

  return (
    <WizardChrome
      activePosition={PORTFOLIO_STEP_INDEX}
      completedCount={5}
      stepIndicator="Optional page details"
      hideOuterProgress
      canExit={!previewMode}
      previewMode={previewMode}
      footer={
        <WizardFooter
          onBack={() => {
            router.push(routeOnBackFromPortfolio(previewMode));
          }}
          onSkip={() => {
            router.push(routeOnSkipFromPortfolio(previewMode));
          }}
          onContinue={handleContinue}
          continueLabel="Save links"
          pending={pending}
        />
      }
    >
      <div className="ob-stagger mx-auto w-full max-w-[620px]">
        <p className="font-mono text-[11px] font-bold tracking-[0.22em] text-[rgb(var(--brand-primary-dark))] uppercase">
          Optional page detail
        </p>
        <h1
          className="font-display mt-3 text-[30px] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          {PORTFOLIO_STEP_TITLE}
        </h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-[rgb(var(--fg-muted))]">
          {PORTFOLIO_STEP_SUBTITLE}
        </p>

        {/* Live preview — colored circles brighten when a URL is filled. */}
        <div className="ob-breath mt-5 flex items-center gap-2.5 rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3.5 py-3">
          <span className="font-mono text-[10.5px] font-bold tracking-[0.18em] text-[rgb(var(--fg-muted))] uppercase">
            Preview
          </span>
          <div className="flex flex-1 gap-1.5">
            {ONBOARDING_PORTFOLIO_PLATFORMS.map((t) => {
              const filled = rows.find((r) => r.type === t)?.url.trim().length ?? 0;
              const meta = PORTFOLIO_PLATFORM_META[t];
              const initial = meta.label[0] ?? "";
              return (
                <span
                  key={t}
                  aria-hidden
                  className="flex h-6 w-6 items-center justify-center rounded-full font-mono text-[10px] font-bold text-white transition-all"
                  style={{
                    background: filled > 0 ? meta.color : "rgb(var(--border-strong))",
                    opacity: filled > 0 ? 1 : 0.5,
                  }}
                  title={meta.label}
                >
                  {initial}
                </span>
              );
            })}
          </div>
          <span className="font-mono text-[10px] tracking-[0.16em] text-[rgb(var(--fg-faint))] uppercase">
            Public page
          </span>
        </div>

        {/* Link rows */}
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((row) => {
            const meta = PORTFOLIO_PLATFORM_META[row.type];
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
                <div className="relative min-h-11 flex-shrink-0">
                  <div className="pointer-events-none flex min-h-11 items-center gap-1 rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-2 py-1.5 text-[11.5px] font-bold tracking-[0.08em] text-[rgb(var(--fg-default))] uppercase">
                    <span className="min-w-[58px]">{PORTFOLIO_PLATFORM_META[row.type].label}</span>
                    <ChevronDown size={11} className="text-[rgb(var(--fg-muted))]" aria-hidden />
                  </div>
                  <select
                    value={row.type}
                    onChange={(e) => {
                      const type = e.target.value as OnboardingPortfolioPlatform;
                      if (
                        rows.some((candidate) => candidate.id !== row.id && candidate.type === type)
                      ) {
                        return;
                      }
                      updateRow(row.id, { type, title: "" });
                    }}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    disabled={pending}
                    aria-label="Link type"
                  >
                    {ONBOARDING_PORTFOLIO_PLATFORMS.map((t) => (
                      <option
                        key={t}
                        value={t}
                        disabled={rows.some(
                          (candidate) => candidate.id !== row.id && candidate.type === t,
                        )}
                      >
                        {PORTFOLIO_PLATFORM_META[t].label}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  type="url"
                  value={row.url}
                  onChange={(e) => {
                    updateRow(row.id, { url: e.target.value });
                  }}
                  placeholder={meta.placeholder}
                  className="min-h-11 min-w-0 flex-1 bg-transparent px-1 py-1 font-mono text-[13px] text-[rgb(var(--fg-default))] outline-none placeholder:text-[rgb(var(--fg-faint))]"
                  disabled={pending}
                />
                {rows.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      removeRow(row.id);
                    }}
                    aria-label="Remove link"
                    className="sk-pop flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[var(--radius-lg)] text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-background))] hover:text-[rgb(var(--fg-default))]"
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
              className="sk-pop flex min-h-11 items-center justify-center gap-1.5 self-start rounded-[var(--radius-sm)] border border-dashed border-[rgb(var(--border-strong))] px-3.5 py-1.5 text-[12px] font-semibold text-[rgb(var(--fg-muted))] transition-colors hover:border-[rgb(var(--brand-primary))] hover:text-[rgb(var(--fg-default))]"
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
