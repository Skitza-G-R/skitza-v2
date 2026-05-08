import "~/styles/landing.css";
import "~/styles/get-started.css";

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { RevealOnScroll } from "~/components/landing/reveal-on-scroll";

import { CtaSection } from "./_components/cta-section";
import { FounderSection } from "./_components/founder-section";
import { HeroSection } from "./_components/hero-section";
import { IsLoadedPing } from "./_components/is-loaded-ping";
import { PainCascadeSection } from "./_components/pain-cascade-section";
import { StaticLogo } from "./_components/static-logo";

// Ad-traffic destination — the route group's layout already sets
// noindex+nofollow. We force-dynamic so the auth check runs per
// request (signed-in producers get redirected to /dashboard rather
// than seeing waitlist copy).
//
// Wrapping the funnel in `.landing-v3-root` lets us inherit the
// homepage's hero motion primitives (.hero-grid-bg, .hero-peek-frame,
// .is-loaded .hero-word stagger) without duplicating them. The
// funnel-specific .get-started-root wraps inside so its own tokens
// (form, eyebrow, demo iframe crop) layer cleanly on top.
export const dynamic = "force-dynamic";

export default async function GetStartedPage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <main className="landing-v3-root get-started-root">
      <IsLoadedPing />
      <RevealOnScroll />

      {/* Minimal logo header — top-left only, no nav, no CTA. Dead-end-
          funnel rule: every off-page link is a conversion leak. */}
      <header
        className="relative z-20"
        style={{ padding: "24px 24px 0" }}
      >
        <div className="mx-auto max-w-7xl">
          <StaticLogo variant="dark" size={40} />
        </div>
      </header>

      <HeroSection locale="en" />

      <section
        id="cascade"
        className="section section-dark"
        style={{ background: "transparent" }}
      >
        <PainCascadeSection locale="en" />
      </section>

      <section
        id="founder"
        className="section section-dark"
        style={{ background: "transparent" }}
      >
        <FounderSection locale="en" />
      </section>

      <section
        id="cta"
        className="section section-dark"
        style={{ background: "transparent" }}
      >
        <CtaSection locale="en" />
      </section>
    </main>
  );
}
