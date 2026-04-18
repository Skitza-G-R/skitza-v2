import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

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
export default async function HomePage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");
  return (
    <div className="bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      <LandingNav />
      <Hero />
      <TrustBar />
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
      <FinalCTA />
      <SiteFooter />
    </div>
  );
}
