import { auth } from "@clerk/nextjs/server";
import { Calendar, Mic2, Package } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";
import { fetchUserRole } from "~/server/auth/role";

import { decideOnboardingRedirect } from "../decide-redirect";
import { nextRouteAfterWelcome } from "./constants";

// Step 0 — Welcome screen.
//
// Introduced by the May 2026 redesign. Sits BEFORE Step 1 (studio) as
// a context-set screen: explains what the producer is about to do,
// sets expectations ("about 2 minutes · skip anything · come back
// later"), and primes them with the three things they'll be asked
// for. NOT counted as one of the 5 numbered rail steps — instead, the
// rail pre-highlights Step 1 ("Your hall") to telegraph what's next.
//
// Layout: WizardChrome (the new shared shell with wordmark header +
// 260px step rail + tip card + main content area). Footer is omitted
// because Welcome doesn't have a Continue button — the CTA inside
// the main column ("Start setting up →") is the only forward action.
//
// Role gate: stepFromPath defaults to "studio" for any unknown path
// (welcome included), so decideOnboardingRedirect("studio", role) is
// the right call. Same matrix as the existing studio page; reusing it
// means we don't have to extend the OnboardingStep type just for a
// presentational pre-step.
//
// Dev-only ?__preview=1 bypass — see lib/onboarding/dev-preview.ts.

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const isPreview = isDevPreviewBypass(params);

  if (!isPreview) {
    const { userId } = await auth();
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("missing DATABASE_URL");

    const role = await fetchUserRole({ dbUrl, userId });
    const redirectTo = decideOnboardingRedirect(role, "studio");
    if (redirectTo) redirect(redirectTo);

    if (
      role.kind !== "producer-incomplete" &&
      role.kind !== "producer-complete" &&
      role.kind !== "orphan"
    ) {
      return null;
    }
  }

  return (
    <WizardChrome activePosition={1} stepIndicator="Setup">
      <div className="ob-stagger flex flex-col items-center text-center">
        {/* Live-dot pill: gold-tinted bg + alive heartbeat (combined
            scale + glow). Reads as breathing rather than blinking. */}
        <span className="mb-7 inline-flex items-center gap-2 rounded-full bg-[rgb(var(--brand-primary)/0.12)] px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[rgb(var(--brand-primary-dark))]">
          <span
            aria-hidden
            className="ob-alive-dot inline-block h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]"
          />
          Welcome
        </span>

        <h1
          className="font-display text-[34px] font-extrabold leading-[1.02] tracking-[-0.035em] text-balance sm:text-5xl"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          Let&apos;s set up
          <br />
          the place where
          <br />
          artists find you
          <span className="text-[rgb(var(--brand-primary))]">.</span>
        </h1>

        <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[rgb(var(--fg-muted))]">
          Five short steps. About two minutes. By the end, you&apos;ll have
          a public link you can paste anywhere — and Skitza will handle
          the rest.
        </p>

        <ul className="mt-7 grid w-full grid-cols-3 gap-2.5 text-left">
          {[
            { Icon: Mic2, label: "Your studio identity" },
            { Icon: Package, label: "One service to start" },
            { Icon: Calendar, label: "Your weekly hours" },
          ].map(({ Icon, label }) => (
            <li
              key={label}
              className="flex items-center gap-2.5 rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] px-3 py-3.5"
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary-dark))]">
                <Icon size={16} aria-hidden />
              </span>
              <span className="text-[13px] font-semibold leading-tight">
                {label}
              </span>
            </li>
          ))}
        </ul>

        <Link
          href={nextRouteAfterWelcome()}
          className="ob-press mt-9 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[rgb(var(--bg-sidebar))] px-5 py-3.5 text-[14px] font-bold text-white shadow-[0_2px_12px_rgba(17,16,9,0.18)] hover:shadow-[0_8px_24px_rgba(17,16,9,0.32)]"
        >
          Start setting up
          <span aria-hidden>→</span>
        </Link>

        <p className="mt-5 font-mono text-[11px] tracking-[0.04em] text-[rgb(var(--fg-muted))]">
          About 2 minutes · Skip anything · Come back later
        </p>
      </div>
    </WizardChrome>
  );
}
