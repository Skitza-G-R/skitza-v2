import { redirect } from "next/navigation";

// Deep-link catch-all for the legacy /dashboard/deals/* surface.
// Forwards to the matching /dashboard/projects/* route — project ids
// are stable across the rename (ALTER TABLE RENAME preserved them).
type PageProps = { params: Promise<{ slug: string[] }> };

export default async function LegacyDealsSubpathRedirect({ params }: PageProps) {
  const { slug } = await params;
  const suffix = slug.join("/");
  redirect(suffix ? `/dashboard/projects/${suffix}` : "/dashboard/projects");
}
