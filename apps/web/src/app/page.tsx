import "~/styles/landing.css";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { LandingPage } from "~/components/landing/landing-page";
import { isDevPreviewBypass } from "~/lib/onboarding/dev-preview";

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
// /dashboard — this route is for cold visitors.
//
// After PR #50, the previous 17-component decomposition broke the hero
// word-fade animation (the `.page-loaded` class went on `<html>` instead
// of inside `.landing-root`, so the descendant selector never matched).
// Pivoted to a single-file verbatim port — see `LandingPage` for the
// full structure. This server component now does the bare minimum:
// auth-redirect, metadata, CSS import, and render the client tree.
type HomePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps = {}) {
  const params = (await searchParams) ?? {};
  if (isDevPreviewBypass(params)) {
    redirect("/onboarding/welcome?__preview=1");
  }

  const { userId } = await auth();
  if (userId) redirect("/dashboard");
  return <LandingPage />;
}
