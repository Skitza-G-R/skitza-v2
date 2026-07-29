import { createFixtureAdminRepository } from "~/features/dashboard/demo-repository";
import { parsePaymentView } from "~/features/dashboard/operations-demo";
import { PaymentsView } from "~/features/dashboard/payments-view";
import { requireRouteEnvironment } from "~/features/dashboard/route-environment";

export default async function AdminPaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ environment: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { environment: rawEnvironment } = await params;
  const { view: rawView } = await searchParams;
  const environment = requireRouteEnvironment(rawEnvironment);
  const repository = createFixtureAdminRepository(environment);
  const data = await repository.listPayments(environment);
  const view = parsePaymentView(Array.isArray(rawView) ? rawView[0] : rawView);

  return <PaymentsView data={data} view={view} />;
}
