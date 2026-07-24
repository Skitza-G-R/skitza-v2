import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ArtistPaymentActionsCard } from "../payment-actions-card";

describe("ArtistPaymentActionsCard", () => {
  it("keeps payment actions separate and never combines currencies", () => {
    const html = renderToStaticMarkup(
      <ArtistPaymentActionsCard
        activeStudioId="studio-selected"
        payments={[
          {
            purchaseId: "purchase-usd",
            studioId: "studio-usd",
            projectTitle: "Debut EP",
            purchaseTitle: "EP production",
            producerName: "Gili Studio",
            currency: "USD",
            dueNowCents: 2_000,
            totalRemainingCents: 8_000,
            statusLabel: "Due now",
            payNextAvailable: true,
          },
          {
            purchaseId: "purchase-ils",
            studioId: "studio-ils",
            projectTitle: "Single",
            purchaseTitle: "Mix and master",
            producerName: "Other Studio",
            currency: "ILS",
            dueNowCents: 0,
            totalRemainingCents: 40_000,
            statusLabel: "Proof under review",
            payNextAvailable: false,
          },
        ]}
      />,
    );

    expect(html).toContain("$20.00");
    expect(html).toContain("$80.00");
    expect(html).toContain("₪400.00");
    expect(html).toContain('href="/artist/payments/purchase-usd?studio=studio-usd"');
    expect(html).toContain('href="/artist/payments?studio=studio-selected"');
    expect(html).toMatch(
      /class="[^"]*min-h-11[^"]*min-w-11[^"]*"[^>]*href="\/artist\/payments\?studio=studio-selected"[^>]*>View all/,
    );
    expect(html).toContain('aria-disabled="false"');
    expect(html).not.toContain("Pay all");
    expect(html).not.toContain("/artist/payment/");
  });
});
