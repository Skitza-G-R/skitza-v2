import {
  buildAgreementTerms,
  MOCK_PRODUCER,
  MOCK_PRODUCT,
} from "~/components/artist/purchase/purchase-data";
import { ReviewAgreeScreen } from "~/components/artist/purchase/review-agree-screen";

type PageProps = { params: Promise<{ productId: string }> };

// S4 — Review & agree (Commit). Mock data while BE-1 (SK-37) is in flight;
// when it lands, swap MOCK_* for the tRPC caller's price-locked product
// snapshot + producer + uploaded agreement — the screen props don't change.
export default async function PurchaseAgreePage({ params }: PageProps) {
  const { productId } = await params;
  const product = { ...MOCK_PRODUCT, id: productId };
  const producer = MOCK_PRODUCER;
  const terms = buildAgreementTerms(producer.name, product.includes);

  return <ReviewAgreeScreen product={product} producer={producer} terms={terms} />;
}
