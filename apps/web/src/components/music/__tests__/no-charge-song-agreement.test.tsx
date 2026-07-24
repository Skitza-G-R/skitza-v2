import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("~/app/(artist)/artist/music/no-charge/[proposalId]/actions", () => ({
  acceptNoChargeSongProposalAction: vi.fn(),
}));

import {
  NoChargeSongAgreement,
  runNoChargeAgreementAction,
} from "../no-charge-song-agreement";

describe("NoChargeSongAgreement", () => {
  it("blocks offline before calling the live acceptance action", async () => {
    const execute = vi.fn(() => Promise.resolve({ ok: true as const }));

    await expect(
      runNoChargeAgreementAction({ online: false, execute }),
    ).resolves.toEqual({
      ok: false,
      error: "Reconnect to accept this agreement.",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("turns a transport rejection into local failure feedback", async () => {
    await expect(
      runNoChargeAgreementAction({
        online: true,
        execute: () => Promise.reject(new Error("network unavailable")),
      }),
    ).resolves.toEqual({
      ok: false,
      error: "Could not accept the agreement. Please try again.",
    });
  });

  it("shows the exact zero-total project, song, source, and artist acceptance gate", () => {
    const html = renderToStaticMarkup(
      <NoChargeSongAgreement
        preview={{
          proposalToken: "signed-proposal-token",
          producerId: "00000000-0000-4000-8000-000000000091",
          projectId: "00000000-0000-4000-8000-000000000092",
          projectTitle: "Summer EP",
          songTitle: "Second Light",
          producerName: "Gili",
          sourceProductId: "00000000-0000-4000-8000-000000000093",
          sourceProductName: "Single production",
          snapshot: {
            version: 1,
            productOrOfferName: "No charge extra song",
            deliverables: ["One song space"],
            lineItems: [
              {
                label: "No charge extra song",
                quantity: 1,
                listUnitPriceCents: 0,
                unitPriceCents: 0,
                totalCents: 0,
              },
            ],
            listSubtotalCents: 0,
            discountCents: 0,
            subtotalCents: 0,
            tax: { mode: "tax_free", ratePct: 0, amountCents: 0 },
            totalCents: 0,
            currency: "ILS",
            includedSongSpaces: 1,
            session: null,
            revisionRule: null,
            royaltyTerms: null,
            rights: [],
            selectedPaymentPlan: null,
            offeredPaymentPlans: [],
            agreementText: "One no charge song for Summer EP.",
          },
          snapshotDigest: "a".repeat(64),
        }}
      />,
    );

    expect(html).toContain("Second Light");
    expect(html).toContain("Summer EP");
    expect(html).toContain("Single production");
    expect(html).toContain("₪0");
    expect(html).toContain("I accept this exact ₪0 agreement for one song.");
    expect(html).not.toContain("payment installment");
    expect(html).not.toContain("fixed inset-0");
  });
});
