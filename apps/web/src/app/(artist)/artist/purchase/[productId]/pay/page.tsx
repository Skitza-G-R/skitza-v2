import { ChoosePlanScreen } from "~/components/artist/purchase/choose-plan-screen";
import {
  MOCK_PLAN_OPTIONS,
  MOCK_PRODUCER,
  MOCK_PRODUCT,
} from "~/components/artist/purchase/pay-data";

type PageProps = { params: Promise<{ productId: string }> };

// S7 — Choose a payment plan (Pay). The (artist) layout already guards the
// role; here we just build the screen props. Mock plans while BE-2 (SK-38)
// is in flight — when it lands, swap MOCK_PLAN_OPTIONS for the tRPC caller's
// per-product allowed plans + price-locked product. The screen props don't
// change.
export default async function ChoosePlanPage({ params }: PageProps) {
  const { productId } = await params;
  const product = { ...MOCK_PRODUCT, id: productId };
  const producer = MOCK_PRODUCER;
  const options = MOCK_PLAN_OPTIONS;

  return <ChoosePlanScreen product={product} producer={producer} options={options} />;
}
