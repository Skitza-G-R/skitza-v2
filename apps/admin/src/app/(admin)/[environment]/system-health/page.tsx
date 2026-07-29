import { createFixtureAdminRepository } from "~/features/dashboard/demo-repository";
import { requireRouteEnvironment } from "~/features/dashboard/route-environment";
import { SystemHealthView } from "~/features/dashboard/system-health-view";

export default async function AdminSystemHealthPage({
  params,
}: {
  params: Promise<{ environment: string }>;
}) {
  const { environment: rawEnvironment } = await params;
  const environment = requireRouteEnvironment(rawEnvironment);
  const repository = createFixtureAdminRepository(environment);
  const data = await repository.getSystemHealth(environment);

  return <SystemHealthView data={data} />;
}
