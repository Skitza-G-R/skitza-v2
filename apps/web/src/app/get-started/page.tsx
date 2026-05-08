import "~/styles/get-started.css";

import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { CtaSection } from "./_components/cta-section";
import { DemoVideoSection } from "./_components/demo-video-section";
import { FounderSection } from "./_components/founder-section";
import { HeroSection } from "./_components/hero-section";
import { IsLoadedPing } from "./_components/is-loaded-ping";
import { PainCascadeSection } from "./_components/pain-cascade-section";
import { StaticLogo } from "./_components/static-logo";

// Ad-traffic destination — the route group's layout already sets
// noindex+nofollow. Force-dynamic so the auth check runs per request
// (signed-in producers get redirected to /dashboard rather than
// seeing waitlist copy).
export const dynamic = "force-dynamic";

export default async function GetStartedPage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <main className="get-started-root">
      <IsLoadedPing />

      <header className="gs-header">
        <div className="container">
          <StaticLogo />
        </div>
      </header>

      {/* Hero + demo on the warm cream surface (above the fold) */}
      <section id="hero">
        <HeroSection locale="en" />
      </section>

      <section id="demo" className="section">
        <DemoVideoSection locale="en" />
      </section>

      {/* Below the fold flips to dark — the homepage's same scroll
          choreography (light → dark transition). */}
      <section id="cascade" className="section section-dark">
        <PainCascadeSection locale="en" />
      </section>

      <section id="founder" className="section section-dark">
        <FounderSection locale="en" />
      </section>

      <section id="cta" className="section section-dark">
        <CtaSection locale="en" />
      </section>
    </main>
  );
}
