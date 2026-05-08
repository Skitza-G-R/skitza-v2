import "~/styles/get-started.css";

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { CtaSection } from "../_components/cta-section";
import { DemoVideoSection } from "../_components/demo-video-section";
import { FounderSection } from "../_components/founder-section";
import { HeroSection } from "../_components/hero-section";
import { IsLoadedPing } from "../_components/is-loaded-ping";
import { PainCascadeSection } from "../_components/pain-cascade-section";
import { StaticLogo } from "../_components/static-logo";

// Hebrew landing page. Same 5 sections, locale='he' threaded through.
// dir/lang on the page-level <div> only — root <html> stays en/ltr
// per CLAUDE.md mistake log 2026-04-20.

export const dynamic = "force-dynamic";

export default async function GetStartedPageHe() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <div lang="he" dir="rtl" className="get-started-root">
      <IsLoadedPing />

      <header className="gs-header">
        <div className="container">
          <StaticLogo />
        </div>
      </header>

      <section id="hero">
        <HeroSection locale="he" />
      </section>

      <section id="demo" className="section">
        <DemoVideoSection locale="he" />
      </section>

      <section id="cascade" className="section section-dark">
        <PainCascadeSection locale="he" />
      </section>

      <section id="founder" className="section section-dark">
        <FounderSection locale="he" />
      </section>

      <section id="cta" className="section section-dark">
        <CtaSection locale="he" />
      </section>
    </div>
  );
}
