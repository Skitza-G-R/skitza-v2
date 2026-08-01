import { notFound } from "next/navigation";

import { createFixtureAdminRepository } from "~/features/dashboard/demo-repository";
import { PaymentDetailView } from "~/features/dashboard/payments-view";
import { requireRouteEnvironment } from "~/features/dashboard/route-environment";

export default async function AdminPaymentDetailPage({
  params,
}: {
  params: Promise<{ environment: string; paymentId: string }>;
}) {
  const { environment: rawEnvironment, paymentId } = await params;
  const environment = requireRouteEnvironment(rawEnvironment);
  const repository = createFixtureAdminRepository(environment);
  const payment = await repository.getPayment(environment, paymentId);

  if (!payment) notFound();

  return <PaymentDetailView environment={environment} payment={payment} />;
}
