import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PaymentSummaryScreen } from "../payment-summary-screen";

function renderSummary(proofUploadsAvailable: boolean): string {
  return renderToStaticMarkup(
    <PaymentSummaryScreen
      purchaseId="purchase-1"
      studioId="producer-1"
      productName="Single production"
      producerName="North Room"
      currency="ILS"
      totalCents={120_000}
      verifiedCents={0}
      remainingCents={120_000}
      currentInstallmentPosition={1}
      proofUploadsAvailable={proofUploadsAvailable}
      proofs={[]}
    />,
  );
}

describe("artist payment summary entry", () => {
  it("keeps payment instructions reachable when Bank and Bit details are missing", () => {
    const html = renderSummary(true);

    expect(html).toContain("View payment instructions");
    expect(html).toContain("will send those details directly");
  });

  it("still blocks upload when the secure backend says it is unavailable", () => {
    const html = renderSummary(false);

    expect(html).toContain("Proof upload is not available yet");
    expect(html).not.toContain("View payment instructions");
  });
});
