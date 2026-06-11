import { auth } from "@clerk/nextjs/server";

import { PaymentInstructionsScreen } from "~/components/artist/purchase/payment-instructions-screen";
import {
  amountDueNowCents,
  MOCK_BANK,
  MOCK_PLAN_OPTIONS,
  MOCK_PRODUCER,
  MOCK_PRODUCT,
  type PaymentPlan,
} from "~/components/artist/purchase/pay-data";

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ plan?: string }>;
};

// S8 — Payment instructions (Pay). Off-app: the amount due now comes from the
// plan the artist picked on S7 (carried in ?plan=), and the bank/Bit details
// are the producer's. Mock while BE-2 (SK-38) is in flight; when it lands, swap
// MOCK_* for the tRPC caller's approved-request snapshot + producer details —
// the screen props don't change.
export default async function PaymentInstructionsPage({
  params,
  searchParams,
}: PageProps) {
  await auth();
  const { productId } = await params;
  const { plan } = await searchParams;

  // Pick the option the artist chose on S7; fall back to "Pay in full".
  const selected =
    MOCK_PLAN_OPTIONS.find((opt) => opt.plan === (plan as PaymentPlan)) ??
    MOCK_PLAN_OPTIONS[0];

  const dueNowCents = selected ? amountDueNowCents(selected) : 0;
  const producer = MOCK_PRODUCER;

  return (
    <PaymentInstructionsScreen
      productId={productId}
      producerName={producer.name}
      amountDueNowCents={dueNowCents}
      bank={MOCK_BANK}
      planParam={plan}
      productName={MOCK_PRODUCT.name}
      planLabel={selected?.title}
    />
  );
}
