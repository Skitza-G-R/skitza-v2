import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AcceptedRequestPaymentProofActions } from "../accepted-request-payment-proof-actions";

describe("accepted Request payment-proof actions", () => {
  it("links each pending proof to its exact existing Payments review page", () => {
    const html = renderToStaticMarkup(
      <AcceptedRequestPaymentProofActions
        proofs={[
          {
            proofId: "00000000-0000-4000-8000-000000000091",
            installmentPosition: 1,
          },
          {
            proofId: "00000000-0000-4000-8000-000000000092",
            installmentPosition: 2,
          },
        ]}
      />,
    );

    expect(html).toContain('href="/dashboard/payments/00000000-0000-4000-8000-000000000091"');
    expect(html).toContain('href="/dashboard/payments/00000000-0000-4000-8000-000000000092"');
    expect(html.match(/Review payment proof/g)).toHaveLength(2);
    expect(html).not.toMatch(/confirm payment|reject proof/i);
  });

  it("does not show a misleading review action when no proof is pending", () => {
    const html = renderToStaticMarkup(<AcceptedRequestPaymentProofActions proofs={[]} />);

    expect(html).toContain("payment follow-up belongs in Payments");
    expect(html).not.toContain("Review payment proof");
    expect(html).not.toContain("/dashboard/payments/");
  });
});
