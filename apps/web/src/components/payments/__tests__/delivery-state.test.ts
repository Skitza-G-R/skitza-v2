import { describe, expect, it } from "vitest";

import { mapPaymentDeliveryState, splitGoogleDriveDeliverables } from "../delivery-state";

describe("SK-44 payment delivery mapping", () => {
  it("maps a fully paid cash purchase to paid delivery", () => {
    expect(
      mapPaymentDeliveryState({
        fullyPaid: true,
        totalCents: 24_000,
        paidCents: 24_000,
        waivedCents: 0,
        remainingCents: 0,
        overdue: false,
        activeOverrideVersionLabels: [],
        googleDriveLinks: [],
        withheldGoogleDriveLinkCount: 0,
      }),
    ).toMatchObject({ key: "paid", label: "Paid · downloads available" });
  });

  it("keeps a zero-total accepted purchase distinct from verified payment", () => {
    expect(
      mapPaymentDeliveryState({
        fullyPaid: true,
        totalCents: 0,
        paidCents: 0,
        waivedCents: 0,
        remainingCents: 0,
        overdue: false,
        activeOverrideVersionLabels: [],
        googleDriveLinks: [],
        withheldGoogleDriveLinkCount: 0,
      }),
    ).toMatchObject({
      key: "no_payment_required",
      label: "No payment required · downloads available",
    });
  });

  it("keeps downward-corrected purchases locked and shows remaining debt", () => {
    expect(
      mapPaymentDeliveryState({
        fullyPaid: false,
        totalCents: 24_000,
        paidCents: 12_000,
        waivedCents: 0,
        remainingCents: 12_000,
        overdue: false,
        activeOverrideVersionLabels: [],
        googleDriveLinks: [],
        withheldGoogleDriveLinkCount: 0,
      }),
    ).toMatchObject({ key: "locked", remainingCents: 12_000 });
  });

  it("keeps waived purchases locked because waiver is not payment", () => {
    expect(
      mapPaymentDeliveryState({
        fullyPaid: false,
        totalCents: 24_000,
        paidCents: 12_000,
        waivedCents: 12_000,
        remainingCents: 0,
        overdue: false,
        activeOverrideVersionLabels: [],
        googleDriveLinks: [],
        withheldGoogleDriveLinkCount: 0,
      }),
    ).toMatchObject({ key: "waived_locked", label: "Settled by waiver · downloads locked" });
  });

  it("shows overdue and exact active override states without hiding debt", () => {
    expect(
      mapPaymentDeliveryState({
        fullyPaid: false,
        totalCents: 24_000,
        paidCents: 6_000,
        waivedCents: 0,
        remainingCents: 18_000,
        overdue: true,
        activeOverrideVersionLabels: ["V2"],
        googleDriveLinks: [],
        withheldGoogleDriveLinkCount: 1,
      }),
    ).toMatchObject({
      key: "early_override",
      label: "Early access · V2 only",
      remainingCents: 18_000,
      overdue: true,
      withheldGoogleDriveLinkCount: 1,
    });
  });

  it("reveals only Google Drive links, and only for fully paid purchases", () => {
    const deliverables = splitGoogleDriveDeliverables([
      "Stereo master",
      "Stems · https://drive.google.com/file/d/stems/view",
      "Notes https://example.com/private",
    ]);

    expect(deliverables.labels).toEqual([
      "Stereo master",
      "Stems",
      "Notes https://example.com/private",
    ]);
    expect(deliverables.googleDriveLinks).toEqual([
      { label: "Stems", href: "https://drive.google.com/file/d/stems/view" },
    ]);

    const unpaid = mapPaymentDeliveryState({
      fullyPaid: false,
      totalCents: 24_000,
      paidCents: 12_000,
      waivedCents: 0,
      remainingCents: 12_000,
      overdue: false,
      activeOverrideVersionLabels: ["V2"],
      googleDriveLinks: deliverables.googleDriveLinks,
      withheldGoogleDriveLinkCount: deliverables.googleDriveLinks.length,
    });
    expect(unpaid.googleDriveLinks).toEqual([]);
    expect(unpaid.withheldGoogleDriveLinkCount).toBe(1);

    const paid = mapPaymentDeliveryState({
      fullyPaid: true,
      totalCents: 24_000,
      paidCents: 24_000,
      waivedCents: 0,
      remainingCents: 0,
      overdue: false,
      activeOverrideVersionLabels: [],
      googleDriveLinks: deliverables.googleDriveLinks,
      withheldGoogleDriveLinkCount: 0,
    });
    expect(paid.googleDriveLinks).toEqual(deliverables.googleDriveLinks);
  });
});
