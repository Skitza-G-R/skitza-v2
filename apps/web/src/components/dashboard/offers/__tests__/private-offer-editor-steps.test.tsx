// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RecipientProjectFields, PrivateOfferQuickStep } from "../private-offer-editor-steps";
import { seedPrivateOfferDraft } from "../private-offer-editor-model";
import type { PrivateOfferTemplateProduct } from "../private-offer-template-types";

const HOURLY_TEMPLATE: PrivateOfferTemplateProduct = {
  source: {
    productId: "hourly-product",
    productName: "Studio session",
    productKind: "hourly",
  },
  terms: {
    name: "Studio session",
    service: "hourly",
    deliverables: ["Recorded session files"],
    cashPriceCents: 18_000,
    currency: "ILS",
    taxMode: "tax_free",
    taxRatePct: 0,
    includedSongSpaces: 0,
    session: null,
    revisionRule: null,
    royaltyTerms: null,
    rights: [],
    enabledPaymentPlans: [{ kind: "full" }],
    agreementText: "Standard studio agreement.",
  },
  pricing: { kind: "hourly", hourlyRateCents: 18_000 },
  rightsNeedCompletion: true,
  agreementNeedsCompletion: false,
};

afterEach(cleanup);

describe("private-offer editor steps", () => {
  it("treats a blank hourly subtotal as required instead of presenting a free offer", () => {
    const draft = seedPrivateOfferDraft({
      defaultCurrency: "ILS",
      taxMode: "tax_free",
      taxRatePct: 0,
      templateProduct: HOURLY_TEMPLATE,
    });

    render(
      <PrivateOfferQuickStep
        idPrefix="hourly-offer"
        draft={draft}
        templateProduct={HOURLY_TEMPLATE}
        recipients={[]}
        projects={[]}
        projectsStatus="idle"
        invalidField={null}
        patch={vi.fn()}
      />,
    );

    const subtotal = screen.getByLabelText<HTMLInputElement>("Fixed private subtotal");
    expect(subtotal.value).toBe("");
    expect(subtotal.required).toBe(true);
    expect(subtotal.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter the fixed subtotal for this offer.")).toBeTruthy();

    const artistPaysLabel = screen.getByText("Artist pays");
    expect(artistPaysLabel.nextElementSibling?.textContent).toBe("—");
    expect(screen.queryByText("Free offers have no payment schedule.")).toBeNull();
  });

  it("disables existing-project selection for a new recipient and explains why", () => {
    const patch = vi.fn();
    const draft = {
      ...seedPrivateOfferDraft({
        defaultCurrency: "ILS",
        taxMode: "tax_free",
        taxRatePct: 0,
      }),
      recipientKind: "new" as const,
      targetKind: "new" as const,
      newRecipientName: "New Artist",
      newRecipientEmail: "artist@example.com",
    };

    render(
      <RecipientProjectFields
        idPrefix="new-recipient"
        draft={draft}
        recipients={[{ id: "client-1", name: "Existing Artist", email: "old@example.com" }]}
        projects={[{ id: "project-1", label: "Existing album" }]}
        projectsStatus="ready"
        invalidField={null}
        patch={patch}
      />,
    );

    const existingProject = screen.getByRole<HTMLButtonElement>("button", {
      name: "Add to an existing project",
    });
    expect(existingProject.disabled).toBe(true);
    expect(screen.getByText("New recipients start with a new project.")).toBeTruthy();

    fireEvent.click(existingProject);
    expect(patch).not.toHaveBeenCalled();
  });
});
