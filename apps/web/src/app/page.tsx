import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { LandingNav } from "~/components/landing/landing-nav";
import { Hero } from "~/components/landing/hero";
import { PainGrid } from "~/components/landing/pain-grid";
import { SolutionFlow } from "~/components/landing/solution-flow";
import { FeaturesTabs } from "~/components/landing/features-tabs";
import { Consolidation } from "~/components/landing/consolidation";
import { HowItWorks } from "~/components/landing/how-it-works";
import { Testimonials } from "~/components/landing/testimonials";
import { Pricing } from "~/components/landing/pricing";
import { FinalCTA } from "~/components/landing/final-cta";

// Marketing landing. Signed-in producers skip this and go straight to
// /dashboard — this route is for cold visitors + waitlist conversion.
// Composition mirrors the user-supplied index.html: light hero → dark
// pain/solution/features/consolidation/how/testimonials/pricing → light
// final CTA + footer. Each section is self-contained.
export default async function HomePage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");
  return (
    <div className="bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]">
      <LandingNav />
      <Hero />
      <PainGrid />
      <SolutionFlow />
      <FeaturesTabs />
      <Consolidation />
      <HowItWorks />
      <Testimonials />
      <Pricing />
      <FinalCTA />
    </div>
  );
}
