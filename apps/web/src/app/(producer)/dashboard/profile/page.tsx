// page.tsx
//
// /dashboard/profile is a legacy URL kept alive only as a redirect.
// New design lives at /dashboard/store; the old portfolio tab moved to
// /dashboard/portfolio.

import { permanentRedirect } from "next/navigation";

export default async function ProfileRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  if (tab === "portfolio") permanentRedirect("/dashboard/portfolio");
  permanentRedirect("/dashboard/store");
}
