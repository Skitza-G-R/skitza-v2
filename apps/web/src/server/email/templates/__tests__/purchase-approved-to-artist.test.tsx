import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";

import { PurchaseApprovedToArtist } from "../purchase-approved-to-artist";

describe("PurchaseApprovedToArtist commercial proposal", () => {
  it("labels the tax-aware total instead of presenting the pre-tax price as total", async () => {
    const html = await render(
      <PurchaseApprovedToArtist
        artistName="Ada"
        producerName="Gili"
        productName="Mix"
        refNumber="REQ-95"
        currency="USD"
        subtotalCents={10_000}
        taxMode="tax_added"
        taxRatePct={18}
        taxCents={1_800}
        totalCents={11_800}
      />,
    );

    expect(html).toContain("Price");
    expect(html).toContain("$100.00");
    expect(html).toContain("<strong>Tax");
    expect(html).toContain("18<!-- -->%");
    expect(html).toContain("$18.00");
    expect(html).toContain("Total");
    expect(html).toContain("$118.00");
  });

  it("discloses included tax without adding it to the total again", async () => {
    const html = await render(
      <PurchaseApprovedToArtist
        artistName="Ada"
        producerName="Gili"
        productName="Master"
        refNumber="REQ-96"
        currency="USD"
        subtotalCents={11_800}
        taxMode="tax_included"
        taxRatePct={18}
        taxCents={1_800}
        totalCents={11_800}
      />,
    );

    expect(html).toContain("<strong>Included tax");
    expect(html).toContain("18<!-- -->%");
    expect(html.match(/\$118\.00/g)).toHaveLength(2);
  });
});
