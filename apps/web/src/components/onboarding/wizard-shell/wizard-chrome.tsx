import Link from "next/link";
import type { ReactNode } from "react";

import { WIZARD_STEPS } from "~/lib/onboarding/wizard-steps";

import { StepRail } from "./step-rail";
import { TipCard } from "./tip-card";
import { Wordmark } from "./wordmark";

export function WizardChrome({
  activePosition,
  completedCount = 1,
  stepIndicator,
  tip,
  children,
  footer,
  hoursNotNeeded = false,
  hideOuterProgress = false,
  canExit = false,
  previewMode = false,
  contentWidth = "default",
}: {
  activePosition: 1 | 2 | 3 | 4 | 5;
  completedCount?: number;
  stepIndicator?: string;
  tip?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  hoursNotNeeded?: boolean;
  hideOuterProgress?: boolean;
  canExit?: boolean;
  previewMode?: boolean;
  contentWidth?: "default" | "wide";
}) {
  const activeStep = WIZARD_STEPS[activePosition - 1];
  const progress = Math.max(1, completedCount, activePosition);

  return (
    <div className="relative flex h-dvh min-h-dvh flex-col overflow-hidden bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-72 overflow-hidden"
      >
        <div className="absolute top-[-10rem] left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-[rgb(var(--brand-primary)/0.10)] blur-[100px] lg:left-[62%] lg:h-[30rem] lg:w-[30rem]" />
      </div>

      <header className="relative z-20 flex h-16 flex-shrink-0 items-center justify-between border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base)/0.92)] px-4 backdrop-blur-xl sm:px-6 lg:h-[72px] lg:px-8">
        <Wordmark size={22} href="/" />
        <div className="flex items-center gap-3">
          <span className="hidden font-mono text-[11px] tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase sm:inline">
            {stepIndicator ?? activeStep?.label ?? "Setup"}
          </span>
          {canExit ? (
            <Link
              href="/dashboard"
              className="inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-3 text-[13px] font-semibold text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none"
            >
              Save &amp; exit
            </Link>
          ) : (
            <span className="text-[12px] font-medium text-[rgb(var(--fg-muted))]">
              Progress saves here
            </span>
          )}
        </div>
      </header>

      <div className="relative z-10 grid min-h-0 flex-1 lg:grid-cols-[288px_minmax(0,1fr)]">
        {!hideOuterProgress ? (
          <aside className="hidden flex-col border-r border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background)/0.56)] px-5 py-7 backdrop-blur-sm lg:flex">
            <div className="mb-3 px-3 font-mono text-[10px] font-bold tracking-[0.2em] text-[rgb(var(--fg-muted))] uppercase">
              Your public page
            </div>
            <StepRail
              activePosition={activePosition}
              completedCount={completedCount}
              hoursNotNeeded={hoursNotNeeded}
              previewMode={previewMode}
            />
            <div className="flex-1" />
            <TipCard>
              {tip ?? (
                <>Your work is saved as you go. You can safely finish later from the dashboard.</>
              )}
            </TipCard>
          </aside>
        ) : null}

        <main
          id="onboarding-main"
          className={`custom-scrollbar min-w-0 overflow-x-hidden overflow-y-auto ${
            hideOuterProgress ? "lg:col-span-2" : ""
          }`}
        >
          {!hideOuterProgress ? (
            <div className="border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background)/0.72)] px-4 py-3 backdrop-blur-sm sm:px-6 lg:hidden">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-[12px] font-bold text-[rgb(var(--fg-default))]">
                  {activeStep?.label}
                </span>
                <span className="flex-shrink-0 font-mono text-[10px] tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                  {progress} of {WIZARD_STEPS.length}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Onboarding progress"
                aria-valuenow={progress}
                aria-valuemin={1}
                aria-valuemax={WIZARD_STEPS.length}
                className="mt-2.5 grid grid-cols-5 gap-1.5"
              >
                {WIZARD_STEPS.map((step) => {
                  const done =
                    step.state === "complete" ||
                    step.position < activePosition ||
                    (step.id === "availability" && hoursNotNeeded);
                  const active = step.position === activePosition;
                  return (
                    <span
                      key={step.id}
                      className={`h-1 rounded-full ${
                        done || active
                          ? "bg-[rgb(var(--brand-primary))]"
                          : "bg-[rgb(var(--border-subtle))]"
                      }`}
                    />
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-[rgb(var(--fg-muted))]">
                Account created <span aria-hidden>✓</span>
              </p>
            </div>
          ) : null}

          <div
            className={`mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 ${
              hideOuterProgress
                ? "max-w-4xl"
                : contentWidth === "wide"
                  ? "max-w-[1180px]"
                  : "max-w-[620px]"
            } ${footer ? "pb-28 lg:pb-24" : "pb-10"}`}
          >
            {children}
          </div>
        </main>
      </div>

      {footer ? (
        <div
          className={`relative z-20 flex-shrink-0 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base)/0.96)] px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-6 lg:px-8 ${
            hideOuterProgress ? "" : "lg:pl-[calc(288px+2rem)]"
          }`}
        >
          <div className="mx-auto w-full max-w-[620px]">{footer}</div>
        </div>
      ) : null}
    </div>
  );
}
