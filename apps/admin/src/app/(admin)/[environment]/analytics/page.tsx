import { AnalyticsView } from "~/features/dashboard/analytics-view";
import { createFixtureAdminRepository } from "~/features/dashboard/demo-repository";
import { requireRouteEnvironment } from "~/features/dashboard/route-environment";

export default async function AdminAnalyticsPage({
  params,
}: {
  params: Promise<{ environment: string }>;
}) {
  const { environment: rawEnvironment } = await params;
  const environment = requireRouteEnvironment(rawEnvironment);
  const repository = createFixtureAdminRepository(environment);
  const data = await repository.getAnalytics(environment);

  return <AnalyticsView data={data} />;
}
