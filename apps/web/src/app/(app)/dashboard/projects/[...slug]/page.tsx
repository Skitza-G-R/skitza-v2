import { redirect } from "next/navigation";

// Catch-all legacy redirect. A bookmarked /dashboard/projects/<uuid>
// sends the producer to /dashboard/deals/<uuid> since ids survive the
// rename (C.1 just renamed the table, primary keys are stable).
type PageProps = { params: Promise<{ slug: string[] }> };

export default async function LegacyProjectsSubpathRedirect({ params }: PageProps) {
  const { slug } = await params;
  const suffix = slug.join("/");
  redirect(suffix ? `/dashboard/deals/${suffix}` : "/dashboard/deals");
}
