import type { Metadata } from "next";
import type { ReactNode } from "react";

// Paid-traffic destination, not organic SEO. Keep search engines out
// so the ad copy ("WhatsApp is not a studio") doesn't compete with
// the homepage in SERPs and so we can iterate ad copy without SEO drag.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

// Minimal layout — no header, no footer, no global nav. The ad funnel
// is a dead end by design (see design doc §3.5). Every off-page link
// is a conversion leak; this layout is the architectural enforcement.
export default function GetStartedLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
