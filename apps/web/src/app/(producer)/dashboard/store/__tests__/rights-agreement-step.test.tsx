import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RightsAgreementStep } from "../editor-steps/rights-agreement-step";
import { royaltyTermsToDraft } from "../product-editor-draft";

describe("RightsAgreementStep", () => {
  it("uses two royalty fieldsets and does not invent a percentage", () => {
    const html = renderToStaticMarkup(
      <RightsAgreementStep
        royalty={royaltyTermsToDraft(null)}
        agreementMode="none"
        contractUrl=""
        agreementText=""
        errors={{}}
        legacyUnspecified={true}
        onRoyaltyChange={() => undefined}
        onAgreementChange={() => undefined}
      />,
    );

    expect(html).toContain("Master rights");
    expect(html).toContain("Composition rights");
    expect(html.match(/<fieldset/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(html).not.toContain('value="12.5"');
    expect(html).not.toContain(">12.5%<");
    expect(html).not.toContain("ACUM member");
  });

  it("progressively reveals percentage-only composition fields", () => {
    const html = renderToStaticMarkup(
      <RightsAgreementStep
        royalty={{
          ...royaltyTermsToDraft(null),
          masterMode: "none",
          compositionMode: "percentage",
          compositionPercentage: "2.5",
        }}
        agreementMode="text"
        contractUrl=""
        agreementText="Credit and payment terms."
        errors={{}}
        legacyUnspecified={false}
        onRoyaltyChange={() => undefined}
        onAgreementChange={() => undefined}
      />,
    );

    expect(html).toContain("Composition percentage");
    expect(html).toContain("Contribution role");
    expect(html).toContain("Collecting society");
    expect(html).toContain("e.g. ACUM");
    expect(html).toContain("Credit and payment terms.");
    expect(html).not.toContain("Master percentage");
  });

  it("renders field-specific validation messages", () => {
    const html = renderToStaticMarkup(
      <RightsAgreementStep
        royalty={royaltyTermsToDraft(null)}
        agreementMode="none"
        contractUrl=""
        agreementText=""
        errors={{
          master: "Choose a master-rights option.",
          composition: "Choose a composition-rights option.",
        }}
        legacyUnspecified={false}
        onRoyaltyChange={() => undefined}
        onAgreementChange={() => undefined}
      />,
    );

    expect(html).toContain("Choose a master-rights option.");
    expect(html).toContain("Choose a composition-rights option.");
    expect(html.match(/role="alert"/g)).toHaveLength(2);
  });

  it("renders an inline agreement error and bounded input", () => {
    const html = renderToStaticMarkup(
      <RightsAgreementStep
        royalty={{
          ...royaltyTermsToDraft(null),
          masterMode: "none",
          compositionMode: "none",
        }}
        agreementMode="link"
        contractUrl="javascript:alert(1)"
        agreementText=""
        errors={{}}
        agreementError="Use a valid http:// or https:// agreement link."
        onRoyaltyChange={() => undefined}
        onAgreementChange={() => undefined}
      />,
    );

    expect(html).toContain("Use a valid http:// or https:// agreement link.");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('maxLength="2048"');
  });

  it("bounds free-form royalty metadata to the save contract", () => {
    const html = renderToStaticMarkup(
      <RightsAgreementStep
        royalty={{
          ...royaltyTermsToDraft(null),
          masterMode: "none",
          compositionMode: "percentage",
          compositionPercentage: "1",
        }}
        agreementMode="none"
        contractUrl=""
        agreementText=""
        errors={{ notes: "Rights notes must be 4,000 characters or fewer." }}
        onRoyaltyChange={() => undefined}
        onAgreementChange={() => undefined}
      />,
    );

    expect(html).toContain('maxLength="200"');
    expect(html).toContain('maxLength="4000"');
    expect(html).toContain("Rights notes must be 4,000 characters or fewer.");
  });
});
