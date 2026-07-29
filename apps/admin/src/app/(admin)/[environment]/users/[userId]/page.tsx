import { notFound } from "next/navigation";

import { createFixtureAdminRepository } from "~/features/dashboard/demo-repository";
import { requireRouteEnvironment } from "~/features/dashboard/route-environment";
import { parseProfileTab, UserProfileView } from "~/features/dashboard/users-view";

export default async function AdminUserProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ environment: string; userId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const { environment: rawEnvironment, userId } = await params;
  const { tab: rawTab } = await searchParams;
  const environment = requireRouteEnvironment(rawEnvironment);
  const repository = createFixtureAdminRepository(environment);
  const data = await repository.getUserProfile(environment, userId);

  if (!data) notFound();

  const tab = parseProfileTab(Array.isArray(rawTab) ? rawTab[0] : rawTab);
  return <UserProfileView data={data} tab={tab} />;
}
