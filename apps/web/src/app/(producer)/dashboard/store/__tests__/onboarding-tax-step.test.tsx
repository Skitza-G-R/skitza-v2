import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OnboardingTaxStep } from "../editor-steps/onboarding-tax-step";

describe("onboarding tax setup", () => {
  it("shows all three modes together with understandable artist totals", () => {
    const html = renderToStaticMarkup(
      <OnboardingTaxStep
        value="tax_added"
        taxRatePct={18}
        currency="USD"
        onChange={() => undefined}
      />,
    );

    expect(html).toContain("Tax-free");
    expect(html).toContain("Tax included");
    expect(html).toContain("Tax added");
    expect(html.match(/Artist pays \$100/g)).toHaveLength(2);
    expect(html).toContain("Artist pays $118");
    expect(html).toContain("This is one studio-wide setting");
  });
});
