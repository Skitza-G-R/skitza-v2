import "~/styles/get-started.css";

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { CtaSection } from "../_components/cta-section";
import { DemoVideoSection } from "../_components/demo-video-section";
import { FounderSection } from "../_components/founder-section";
import { HeroSection } from "../_components/hero-section";
import { PainCascadeSection } from "../_components/pain-cascade-section";
import { StaticLogo } from "../_components/static-logo";

// Hebrew landing page. Same 5 sections as the EN page, with locale="he"
// threaded through each section. dir/lang live on the page-level
// <div> — root <html> stays en/ltr (CLAUDE.md mistake log 2026-04-20:
// next-themes + Clerk hydration breaks if root <html> is RTL).

export const dynamic = "force-dynamic";

export default async function GetStartedPageHe() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <div lang="he" dir="rtl" className="get-started-root get-started-root--he">
      <header className="px-6 py-6">
        <StaticLogo />
      </header>
      <section id="hero" className="px-6 py-12">
        <HeroSection locale="he" />
      </section>
      <section id="demo" className="px-6 py-16 sm:py-20">
        <DemoVideoSection />
      </section>
      <section id="cascade" className="px-6 py-16 sm:py-20">
        <PainCascadeSection locale="he" />
      </section>
      <section
        id="founder"
        className="bg-[rgb(var(--bg-elevated))] px-6 py-16 sm:py-20"
      >
        <FounderSection locale="he" />
      </section>
      <section id="cta" className="px-6 py-16 sm:py-24">
        <CtaSection locale="he" />
      </section>
    </div>
  );
}
