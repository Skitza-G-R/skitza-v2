import type { Db } from "@skitza/db";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PurchaseDeclinedToArtist } from "~/server/email/templates/purchase-declined-to-artist";
import {
  emitAgreementAccepted,
  emitPurchaseApproved,
  emitPurchaseDeclined,
  emitPurchaseRequested,
} from "./emit";

class CaptureInsertDb {
  readonly values: Array<Record<string, unknown>> = [];

  insert() {
    return {
      values: (value: Record<string, unknown>) => {
        this.values.push(value);
        return Promise.resolve();
      },
    };
  }

  asDb(): Db {
    return this as unknown as Db;
  }
}

describe("purchase request notifications", () => {
  it("retains the exact request id throughout the request and acceptance events", async () => {
    const db = new CaptureInsertDb();
    const common = {
      producerId: "00000000-0000-4000-8000-000000000071",
      purchaseRequestId: "00000000-0000-4000-8000-000000000072",
      artistName: "Maya",
      productName: "Three-song production",
      refNumber: "SK-72",
    };

    await emitPurchaseRequested(db.asDb(), {
      ...common,
      artistEmail: "maya@example.invalid",
    });
    await emitPurchaseApproved(db.asDb(), common);
    await emitPurchaseDeclined(db.asDb(), common);
    await emitAgreementAccepted(db.asDb(), common);

    expect(db.values.map((row) => row.purchaseRequestId)).toEqual([
      common.purchaseRequestId,
      common.purchaseRequestId,
      common.purchaseRequestId,
      common.purchaseRequestId,
    ]);
    expect(db.values.map((row) => row.kind)).toEqual([
      "purchase_requested",
      "purchase_approved",
      "purchase_declined",
      "agreement_accepted",
    ]);
  });

  it("keeps a decline reason producer-private and out of the artist email", async () => {
    const privateReason = "PRIVATE-SENTINEL: capacity changed";
    const db = new CaptureInsertDb();
    await emitPurchaseDeclined(db.asDb(), {
      producerId: "00000000-0000-4000-8000-000000000071",
      purchaseRequestId: "00000000-0000-4000-8000-000000000072",
      artistName: "Maya",
      productName: "Three-song production",
      refNumber: "SK-72",
      reason: privateReason,
    });

    expect(db.values[0]?.body).toContain(privateReason);
    const artistEmail = renderToStaticMarkup(
      <PurchaseDeclinedToArtist
        artistName="Maya"
        producerName="Gili Studio"
        productName="Three-song production"
        refNumber="SK-72"
      />,
    );
    expect(artistEmail).toContain("isn&#x27;t able to take this one on right now");
    expect(artistEmail).not.toContain(privateReason);
  });
});
