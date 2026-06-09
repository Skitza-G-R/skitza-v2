import { auth } from "@clerk/nextjs/server";

import {
  MOCK_PAID_CENTS,
  MOCK_PROOFS,
  MOCK_TOTAL_CENTS,
} from "~/components/artist/purchase/pay-data";
import {
  MOCK_PRODUCER,
  MOCK_PRODUCT,
} from "~/components/artist/purchase/purchase-data";
import { UploadProofScreen } from "~/components/artist/purchase/upload-proof-screen";

type PageProps = { params: Promise<{ productId: string }> };

// S9 — Upload proof of payment (Pay). v1 is OFF-APP: the artist pays by bank
// transfer / Bit, then uploads a screenshot or PDF here for the producer to
// verify (Gate 2). Mock data while BE-2 (SK-38) is in flight; when the
// presigned-upload + Gate-2 procedures land, swap MOCK_* for the tRPC
// caller's plan + proofs + running total — the screen props don't change.
//
// The `auth()` check is defense-in-depth: middleware → layout → page.
export default async function PurchaseProofPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const { productId } = await params;
  const product = { ...MOCK_PRODUCT, id: productId };
  const producer = MOCK_PRODUCER;

  const paidCents = MOCK_PAID_CENTS;
  const totalCents = MOCK_TOTAL_CENTS;
  // The amount this next proof is expected to cover = whatever's still owed.
  const thisProofCents = Math.max(0, totalCents - paidCents);

  return (
    <UploadProofScreen
      product={product}
      producer={producer}
      proofs={MOCK_PROOFS}
      paidCents={paidCents}
      totalCents={totalCents}
      thisProofCents={thisProofCents}
    />
  );
}
