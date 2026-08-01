import { auth } from "@clerk/nextjs/server";
import { CalendarClock, Check, Package, UserRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { WizardChrome } from "~/components/onboarding/wizard-shell/wizard-chrome";
import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";
import { fetchUserRole } from "~/server/auth/role";

import { decideOnboardingRedirect } from "../decide-redirect";
import { nextRouteAfterWelcome } from "./constants";

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
    <WizardChrome
      activePosition={2}
      completedCount={1}
      stepIndicator="Public page setup"
      previewMode={isPreview}
    >
      <div className="ob-stagger">
        <span className="inline-flex min-h-8 items-center gap-2 rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary)/0.12)] px-3 font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary-dark))] uppercase">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--bg-sidebar))]">
            <Check size={11} strokeWidth={3} aria-hidden />
          </span>
          Account created
        </span>

        <h1
          className="font-display mt-5 max-w-[13ch] text-[38px] leading-[0.98] font-extrabold tracking-[-0.04em] text-balance sm:text-[50px]"
          style={{ fontVariationSettings: '"opsz" 96' }}
        >
          Build the page artists meet first
          <span className="text-[rgb(var(--brand-primary))]">.</span>
        </h1>

        <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-[rgb(var(--fg-muted))] sm:text-[16px]">
          Add your public name, one real product, and working hours only when that product needs
          them. Your progress is saved as you go.
        </p>

        <ul className="mt-7 grid gap-2.5 sm:grid-cols-3">
          {[
            {
              Icon: UserRound,
              label: "Your public page",
              detail: "Name and link",
            },
            {
              Icon: Package,
              label: "Your first product",
              detail: "Hidden until review",
            },
            {
              Icon: CalendarClock,
              label: "Working hours",
              detail: "Only if needed",
            },
          ].map(({ Icon, label, detail }) => (
            <li
              key={label}
              className="flex min-h-[72px] items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated)/0.8)] px-3.5 py-3 shadow-[0_10px_35px_rgb(var(--bg-sidebar)/0.04)]"
            >
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary-dark))]">
                <Icon size={14} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] leading-tight font-bold text-[rgb(var(--fg-default))]">
                  {label}
                </span>
                <span className="mt-1 block text-[11px] leading-tight text-[rgb(var(--fg-muted))]">
                  {detail}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-5 rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.28)] bg-[rgb(var(--brand-primary)/0.07)] px-4 py-3 text-[13px] leading-relaxed text-[rgb(var(--fg-secondary))]">
          Nothing goes live until you see the artist view and choose to publish.
        </div>

        <Link
          href={`${nextRouteAfterWelcome()}${isPreview ? "?__preview=1" : ""}`}
          className="ob-press mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-5 text-[14px] font-bold text-white shadow-[0_12px_32px_rgb(var(--bg-sidebar)/0.20)] hover:shadow-[0_16px_40px_rgb(var(--bg-sidebar)/0.30)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:outline-none sm:w-auto sm:min-w-48"
        >
          Start setup
          <span aria-hidden>→</span>
        </Link>

        <p className="mt-3 text-[12px] text-[rgb(var(--fg-muted))]">
          A few minutes · Progress saved · Dashboard opens after your name
        </p>
      </div>
    </WizardChrome>
  );
}
