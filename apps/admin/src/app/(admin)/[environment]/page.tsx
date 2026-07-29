import { createFixtureAdminRepository } from "~/features/dashboard/demo-repository";
import { OverviewView } from "~/features/dashboard/overview-view";
import { requireRouteEnvironment } from "~/features/dashboard/route-environment";

export default async function AdminEnvironmentHomePage({
  params,
}: {
  params: Promise<{ environment: string }>;
}) {
  const { environment: rawEnvironment } = await params;
  const environment = requireRouteEnvironment(rawEnvironment);
  const repository = createFixtureAdminRepository(environment);
  const data = await repository.getOverview(environment);

  return <OverviewView data={data} />;
}
