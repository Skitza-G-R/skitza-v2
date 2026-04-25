import "~/styles/landing.css";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { NoiseOverlay } from "~/components/landing/noise-overlay";
import { RevealOnScroll } from "~/components/landing/reveal-on-scroll";
import { LandingNav } from "~/components/landing/landing-nav";
import { Hero } from "~/components/landing/hero";
import { TrustBar } from "~/components/landing/trust-bar";
import { PainGrid } from "~/components/landing/pain-grid";
import { SolutionFlow } from "~/components/landing/solution-flow";
import { FeaturesTabs } from "~/components/landing/features-tabs";
import { Compare } from "~/components/landing/compare";
import { HowItWorks } from "~/components/landing/how-it-works";
import { Consolidation } from "~/components/landing/consolidation";
import { Security } from "~/components/landing/security";
import { Testimonials } from "~/components/landing/testimonials";
import { Pricing } from "~/components/landing/pricing";
import { FAQ } from "~/components/landing/faq";
import { Founder } from "~/components/landing/founder";
import { Download } from "~/components/landing/download";
import { FinalCTA } from "~/components/landing/final-cta";
import { SiteFooter } from "~/components/landing/site-footer";

// Explicit landing metadata — overrides the root layout's template for the
// homepage and pins robots.index+follow so Next can't accidentally inherit
// a `noindex` from a nested route's generateMetadata.
export const metadata: Metadata = {
  title: "Skitza — Run your producer business",
  description:
    "CRM, audio collaboration, booking, and contracts — unified for solo music producers. One URL. Every client. Every session. Every bounce.",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  openGraph: {
    title: "Skitza — Run your producer business",
    description:
      "CRM, audio collaboration, booking, and contracts — unified for solo music producers.",
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Skitza — Run your producer business",
    description:
      "CRM, audio collaboration, booking, and contracts — unified for solo music producers.",
  },
};

// Marketing landing. Signed-in producers skip this and go straight to
// /dashboard — this route is for cold visitors. Composition: warm light
// hero → trust bar → dark pain/solution/features/compare/how/
// consolidation/security/testimonials/pricing/faq/founder/download → back
// to light final CTA + footer. Each section is self-contained.
//
// Wrapper is `.landing-root` (S1, 2026-04-26) — every selector in
// apps/web/src/styles/landing.css is scoped under it, so the warm
// off-white tokens (`--light-bg`, `--amber`, `--copper`, `--font-head`,
// `--font-body`) live ONLY here and cannot leak into the authed app via
// cached CSS. NoiseOverlay is rendered first so the SVG film-grain
// layer composites above every section without affecting tab order.
//
// S2 (2026-04-26): the 11 original sections are now ports of the
// founder's source HTML and use only `landing.css` classes. The 6 new
// sections (TrustBar, Compare, Security, FAQ, Founder, Download) are
// still the old token-based components — S3 will restyle them.
//
// Why <main className="dark-world"> wraps the middle: source line 1275
// puts the dark sections inside a single `<main class="dark-world">`
// which lets `landing.css .dark-world` paint the bg-color and flip
// every nested watermark/heading to its dark-palette colour in one
// declaration. The light-themed sections (hero, trust bar, final CTA,
// footer) sit outside the main element so they keep the warm light bg.
export default async function HomePage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");
  return (
    <div className="landing-root">
      <NoiseOverlay />
      <RevealOnScroll />
      <LandingNav />
      <Hero />
      <TrustBar />
      <main className="dark-world">
        <PainGrid />
        <SolutionFlow />
        <FeaturesTabs />
        <Compare />
        <HowItWorks />
        <Consolidation />
        <Security />
        <Testimonials />
        <Pricing />
        <FAQ />
        <Founder />
        <Download />
      </main>
      <FinalCTA />
      <SiteFooter />
    </div>
  );
}
