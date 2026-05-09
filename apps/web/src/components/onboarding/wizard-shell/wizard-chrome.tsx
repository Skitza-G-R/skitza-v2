import type { ReactNode } from "react";

import { StepRail } from "./step-rail";
import { TipCard } from "./tip-card";
import { Wordmark } from "./wordmark";

// Desktop wizard shell — the warm-canvas frame the producer lives
// inside for the entire onboarding flow.
//
// Layout (per redesign README §"Shell — desktop layout"):
//
//   ┌────────────────────────────────────────────────────────────┐
//   │ HEADER  64px  — wordmark · "Step N of 5" · Save & exit     │
//   ├──────────┬─────────────────────────────────────────────────┤
//   │  RAIL    │  MAIN  (centered, max-width 540px, scrollable)  │
//   │  260px   │                                                 │
//   │          │                                                 │
//   │  Tip     │                                                 │
//   ├──────────┴─────────────────────────────────────────────────┤
//   │ FOOTER  pinned absolute bottom (optional — Welcome omits)  │
//   └────────────────────────────────────────────────────────────┘
//
// The shell is server-rendered. Children fill the main area. Footer
// is opt-in — Welcome omits it (no Continue/Back yet). Subsequent
// step pages will pass a footer slot.
//
// Mobile layout is intentionally NOT handled here — Skitza's producer
// platform is desktop-first per CLAUDE.md ("Desktop only for producer.
// Artist song page has dedicated mobile UI."). A separate mobile
// shell will land if/when the producer wizard becomes mobile-supported.

export function WizardChrome({
  activePosition,
  completedCount = 0,
  stepIndicator,
  tip,
  children,
  footer,
}: {
  /** Which rail row to highlight as active (1..5). */
  activePosition: 1 | 2 | 3 | 4 | 5;
  /** Steps strictly before activePosition that are "done" (gold + check). */
  completedCount?: number;
  /**
   * Right-of-header copy. Defaults to "Setup" for Welcome; step pages
   * pass "Step 2 of 5" etc. Pinned at the call site so the wizard
   * data flow stays one-direction (parent → chrome) and the chrome
   * doesn't need to look up the active step's position itself.
   */
  stepIndicator?: string;
  /** Tip card body. Defaults to the welcome reassurance copy. */
  tip?: ReactNode;
  /** Main column content. Centered + max-width 540 by the shell. */
  children: ReactNode;
  /** Optional sticky footer (Continue / Back / Skip). Welcome omits. */
  footer?: ReactNode;
}) {
  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      {/* Header — 64px, wordmark left, indicator + Save & exit right. */}
      <header className="flex h-16 flex-shrink-0 items-center justify-between border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-7">
        <Wordmark size={22} href="/" />
        <div className="flex items-center gap-3.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-[rgb(var(--fg-muted))]">
            {stepIndicator ?? "Setup"}
          </span>
          <button
            type="button"
            className="sk-pop text-[12.5px] font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
          >
            Save &amp; exit
          </button>
        </div>
      </header>

      {/* Body grid: 260px rail + flexible main. */}
      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr]">
        <aside className="flex flex-col gap-4 border-r border-[rgb(var(--border-subtle))] bg-[rgb(255,255,255,0.4)] px-4 py-7">
          <div>
            <div className="mb-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[rgb(var(--fg-muted))]">
              Setup
            </div>
            <StepRail
              activePosition={activePosition}
              completedCount={completedCount}
            />
          </div>
          <div className="flex-1" />
          <TipCard>
            {tip ?? (
              <>
                Don&apos;t overthink it. You can change every single thing
                later — even your link.
              </>
            )}
          </TipCard>
        </aside>

        <main className="custom-scrollbar overflow-y-auto overflow-x-hidden px-6 py-4 pb-[80px]">
          <div className="mx-auto w-full max-w-[540px]">{children}</div>
        </main>
      </div>

      {/* Optional sticky footer — anchored to bottom of the main column. */}
      {footer ? (
        <div className="absolute bottom-0 left-[260px] right-0 z-10 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-8 py-3.5">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
