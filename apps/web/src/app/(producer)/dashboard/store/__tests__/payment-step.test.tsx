import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PaymentStep } from "../editor-steps/payment-step";

const FULL_SPLIT_MONTHLY = {
  full: true,
  split50: true,
  monthly: true,
  monthlyInstallments: 4,
};

describe("PaymentStep", () => {
  it("uses a fieldset with three native multi-select checkboxes", () => {
    const html = renderToStaticMarkup(
      <PaymentStep
        selection={FULL_SPLIT_MONTHLY}
        previewTotalCents={100_03}
        currency="USD"
        pricingModel="flat"
        onChange={() => undefined}
      />,
    );

    expect(html).toContain("<fieldset");
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html).not.toContain('role="radio"');
    expect(html).not.toContain("Choose one or more. The artist picks after approval.");
  });

  it("renders cent-accurate previews and the monthly control only when enabled", () => {
    const html = renderToStaticMarkup(
      <PaymentStep
        selection={FULL_SPLIT_MONTHLY}
        previewTotalCents={100_03}
        currency="USD"
        pricingModel="flat"
        onChange={() => undefined}
      />,
    );

    expect(html).toContain("$100.03");
    expect(html).toContain("$50.02");
    expect(html).toContain("$25.03");
    expect(html).toContain("$100.03 at acceptance");
    expect(html).toContain("$50.01 when the artist approves the final version");
    expect(html).not.toMatch(/after approval|on delivery/i);
    expect(html).toContain('aria-label="Decrease monthly payments"');
    expect(html).toContain('aria-label="Increase monthly payments"');
  });

  it("labels per-song previews as a one-song starting-rate example", () => {
    const html = renderToStaticMarkup(
      <PaymentStep
        selection={{ ...FULL_SPLIT_MONTHLY, monthly: false }}
        previewTotalCents={15_000}
        currency="USD"
        pricingModel="per_song"
        onChange={() => undefined}
      />,
    );

    expect(html).toMatch(/one song|starting rate/i);
  });

  it("surfaces an inline error for an empty selection", () => {
    const html = renderToStaticMarkup(
      <PaymentStep
        selection={{
          full: false,
          split50: false,
          monthly: false,
          monthlyInstallments: 4,
        }}
        previewTotalCents={20_000}
        currency="USD"
        pricingModel="flat"
        error="Choose at least one payment option."
        onChange={() => undefined}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Choose at least one payment option.");
  });
});
