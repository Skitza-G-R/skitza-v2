import { describe, expect, it } from "vitest";

import { presentVersionDelivery } from "../delivery-state";

describe("SK-44 exact-version delivery presentation", () => {
  it("presents fully paid and zero-total entitlements as downloadable", () => {
    for (const totalCents of [18_000, 0]) {
      expect(
        presentVersionDelivery({
          purchaseId: "purchase-paid",
          permission: "purchase_fully_paid",
          fullyPaid: true,
          remainingCents: 0,
          currency: "ILS",
          overdue: false,
          totalCents,
        }),
      ).toMatchObject({
        key: "paid",
        badge: "Paid",
        canDownload: true,
      });
    }
  });

  it("keeps unpaid and corrected purchases locked with their exact remaining debt", () => {
    expect(
      presentVersionDelivery({
        purchaseId: "purchase-corrected",
        permission: "payment_required",
        fullyPaid: false,
        remainingCents: 6_000,
        currency: "ILS",
        overdue: false,
        totalCents: 18_000,
      }),
    ).toMatchObject({
      key: "locked",
      badge: "Locked",
      canDownload: false,
      remainingCents: 6_000,
    });
  });

  it("shows overdue debt without changing streaming or granting download", () => {
    expect(
      presentVersionDelivery({
        purchaseId: "purchase-overdue",
        permission: "payment_required",
        fullyPaid: false,
        remainingCents: 4_500,
        currency: "ILS",
        overdue: true,
        totalCents: 18_000,
      }),
    ).toMatchObject({
      key: "overdue",
      badge: "Overdue · locked",
      canDownload: false,
    });
  });

  it("shows the exact-version early override while preserving its debt", () => {
    expect(
      presentVersionDelivery({
        purchaseId: "purchase-override",
        permission: "version_override",
        fullyPaid: false,
        remainingCents: 9_000,
        currency: "ILS",
        overdue: false,
        totalCents: 18_000,
      }),
    ).toMatchObject({
      key: "early_override",
      badge: "Early access",
      canDownload: true,
      remainingCents: 9_000,
    });
  });

  it("removes play and download presentation from deleted audio", () => {
    expect(
      presentVersionDelivery({
        purchaseId: "purchase-deleted",
        permission: "audio_deleted",
        fullyPaid: true,
        remainingCents: 0,
        currency: "ILS",
        overdue: false,
        totalCents: 18_000,
      }),
    ).toMatchObject({
      key: "deleted",
      badge: "Audio deleted",
      canDownload: false,
    });
  });
});
