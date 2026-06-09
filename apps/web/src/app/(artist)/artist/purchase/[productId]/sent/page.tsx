import {
  makeRequestRef,
  MOCK_PRODUCER,
  MOCK_PRODUCT,
} from "~/components/artist/purchase/purchase-data";
import { RequestSentScreen } from "~/components/artist/purchase/request-sent-screen";

type PageProps = { params: Promise<{ productId: string }> };

// S5 — Request sent (Commit). Mock ref derived from the product; BE-1
// returns the real ref from `artist.purchase.request`.
export default async function PurchaseSentPage({ params }: PageProps) {
  const { productId } = await params;
  const product = { ...MOCK_PRODUCT, id: productId };
  const producer = MOCK_PRODUCER;
  const requestRef = makeRequestRef(product);

  return (
    <RequestSentScreen product={product} producer={producer} requestRef={requestRef} />
  );
}
