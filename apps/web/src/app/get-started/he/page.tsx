import "~/styles/landing.css";
import "~/styles/get-started.css";

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { RevealOnScroll } from "~/components/landing/reveal-on-scroll";

import { CtaSection } from "../_components/cta-section";
import { FounderSection } from "../_components/founder-section";
import { HeroSection } from "../_components/hero-section";
import { IsLoadedPing } from "../_components/is-loaded-ping";
import { PainCascadeSection } from "../_components/pain-cascade-section";
import { StaticLogo } from "../_components/static-logo";

// Hebrew landing page. Same structure as EN, locale='he' threaded
// through. dir/lang on the page-level <div> only — root <html> stays
// en/ltr per CLAUDE.md mistake log 2026-04-20.

export const dynamic = "force-dynamic";

export default async function GetStartedPageHe() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <div
      lang="he"
      dir="rtl"
      className="landing-v3-root get-started-root"
    >
      <IsLoadedPing />
      <RevealOnScroll />

      <header
        className="relative z-20"
        style={{ padding: "24px 24px 0" }}
      >
        <div className="mx-auto max-w-7xl">
          <StaticLogo variant="dark" size={40} />
        </div>
      </header>

      <HeroSection locale="he" />

      <section
        id="cascade"
        className="section section-dark"
        style={{ background: "transparent" }}
      >
        <PainCascadeSection locale="he" />
      </section>

      <section
        id="founder"
        className="section section-dark"
        style={{ background: "transparent" }}
      >
        <FounderSection locale="he" />
      </section>

      <section
        id="cta"
        className="section section-dark"
        style={{ background: "transparent" }}
      >
        <CtaSection locale="he" />
      </section>
    </div>
  );
}
