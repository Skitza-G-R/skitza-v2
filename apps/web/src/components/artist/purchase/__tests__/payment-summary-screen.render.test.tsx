import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PaymentSummaryScreen,
  type ArtistProofUploadAvailability,
} from "../payment-summary-screen";

function renderSummary(proofUploadAvailability: ArtistProofUploadAvailability): string {
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
      proofUploadAvailability={proofUploadAvailability}
      proofs={[]}
    />,
  );
}

describe("artist payment summary entry", () => {
  it("keeps payment instructions reachable when Bank and Bit details are missing", () => {
    const html = renderSummary({ status: "available" });

    expect(html).toContain("Pay &amp; upload proof");
    expect(html).toContain("will send those details directly");
  });

  it("explains an approval-triggered final installment without pretending the uploader is missing", () => {
    const html = renderSummary({
      status: "not_due",
      installmentPosition: 2,
      dueTrigger: "artist_approval",
      dueAt: null,
    });

    expect(html).toContain("Next payment isn’t due yet");
    expect(html).toContain("opens after you approve the required final version");
    expect(html).not.toContain("Proof upload is not available yet");
    expect(html).not.toContain("Pay &amp; upload proof");
  });

  it("keeps a canceled purchase closed instead of offering another proof", () => {
    const html = renderSummary({ status: "purchase_canceled" });

    expect(html).toContain("This purchase is closed");
    expect(html).not.toContain("Pay &amp; upload proof");
  });

  it("uses the standing Artist shell spacing instead of nesting another main landmark", () => {
    const html = renderSummary({ status: "available" });

    expect(html).not.toContain("<main");
    expect(html).toContain('href="/artist/payments?studio=producer-1"');
  });
});
