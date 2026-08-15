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

  it("renders an inline agreement error and bounded exact-terms input", () => {
    const html = renderToStaticMarkup(
      <RightsAgreementStep
        royalty={{
          ...royaltyTermsToDraft(null),
          masterMode: "none",
          compositionMode: "none",
        }}
        agreementMode="text"
        agreementText=""
        errors={{}}
        agreementError="Write the agreement terms or choose no attachment."
        onRoyaltyChange={() => undefined}
        onAgreementChange={() => undefined}
      />,
    );

    expect(html).toContain("Write the agreement terms or choose no attachment.");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('maxLength="20000"');
    expect(html).toContain("Write exact terms");
    expect(html).not.toContain("Add a link");
    expect(html).not.toContain("Public agreement link");
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

  it("renders the complete empty PDF dropzone", () => {
    const html = renderToStaticMarkup(
      <RightsAgreementStep
        royalty={royaltyTermsToDraft(null)}
        agreementMode="pdf"
        agreementText=""
        errors={{}}
        onRoyaltyChange={() => undefined}
        onAgreementChange={() => undefined}
        onAgreementPdfSelect={() => undefined}
      />,
    );

    expect(html).toContain("Drop your agreement PDF here");
    expect(html).toContain("or tap to choose a file");
    expect(html).toContain("PDF only · up to 15 MB");
    expect(html).toContain('accept="application/pdf,.pdf"');
  });

  it("keeps the dropzone after upload and offers explicit removal", () => {
    const html = renderToStaticMarkup(
      <RightsAgreementStep
        royalty={royaltyTermsToDraft(null)}
        agreementMode="pdf"
        agreementText=""
        agreementPdf={{
          documentId: "document-1",
          originalFileName: "producer-terms.pdf",
          sizeBytes: 2_097_152,
        }}
        errors={{}}
        onRoyaltyChange={() => undefined}
        onAgreementChange={() => undefined}
        onAgreementPdfSelect={() => undefined}
        onAgreementPdfRemove={() => undefined}
      />,
    );

    expect(html).toContain("producer-terms.pdf");
    expect(html).toContain("PDF · 2.0 MB");
    expect(html).toContain("Drop a new PDF here to replace it");
    expect(html).toContain(">Remove</button>");
    expect(html).toContain('accept="application/pdf,.pdf"');
  });
});
