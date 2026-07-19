import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ClientMoneyLedger, type ClientMoneyLedgerData } from "../client-money-ledger";

const data: ClientMoneyLedgerData = {
  currencyTotals: [
    {
      currency: "USD",
      purchasedCents: 120000,
      paidCents: 70000,
      remainingCents: 50000,
    },
    {
      currency: "ILS",
      purchasedCents: 360000,
      paidCents: 360000,
      remainingCents: 0,
    },
  ],
  projects: [
    {
      id: "project-1",
      title: "Debut EP",
      lifecycleStatus: "active",
      currencyTotals: [
        {
          currency: "USD",
          purchasedCents: 120000,
          paidCents: 70000,
          remainingCents: 50000,
        },
      ],
      purchases: [
        {
          id: "purchase-1",
          reference: "SK-1001",
          title: "EP production",
          lifecycleStatus: "active",
          acceptedAtIso: "2026-07-17T12:00:00.000Z",
          currency: "USD",
          subtotalCents: 110000,
          taxCents: 10000,
          totalCents: 120000,
          paidCents: 70000,
          remainingCents: 50000,
          payments: [
            {
              id: "payment-1",
              amountCents: 70000,
              currency: "USD",
              paidAtIso: "2026-07-18T12:00:00.000Z",
              source: "proof",
              note: null,
            },
          ],
          proofs: [
            {
              id: "proof-1",
              amountCents: 70000,
              currency: "USD",
              status: "confirmed",
              originalFileName: "bank-transfer-july.pdf",
              createdAtIso: "2026-07-18T11:00:00.000Z",
              rejectionNote: null,
            },
          ],
        },
      ],
    },
  ],
};

describe("ClientMoneyLedger", () => {
  it("renders separate currencies and every project, purchase, payment, and proof", () => {
    const html = renderToStaticMarkup(<ClientMoneyLedger data={data} />);

    expect(html).toContain("USD");
    expect(html).toContain("ILS");
    expect(html).toContain("Debut EP");
    expect(html).toContain("EP production");
    expect(html).toContain("SK-1001");
    expect(html).toContain("Confirmed payment");
    expect(html).toContain("bank-transfer-july.pdf");
    expect(html).toContain("Purchased");
    expect(html).toContain("Paid");
    expect(html).toContain("Remaining");
    expect(html).toContain("Subtotal");
    expect(html).toContain("Tax");
    expect(html).not.toContain("Due now");
    expect(html).not.toContain("href=");
  });

  it("uses one stable three-column Total / Paid / Remaining purchase summary", () => {
    const html = renderToStaticMarkup(<ClientMoneyLedger data={data} />);

    expect(html).toContain("grid-cols-3");
    expect(html).not.toContain("grid-cols-5");
    expect(html).toMatch(/Total[\s\S]*Paid[\s\S]*Remaining/);
  });

  it("renders an explicit empty state", () => {
    const html = renderToStaticMarkup(
      <ClientMoneyLedger data={{ currencyTotals: [], projects: [] }} />,
    );
    expect(html).toContain("No purchases or payments yet");
  });

  it("shows exact cents instead of rounding immutable money history", () => {
    const html = renderToStaticMarkup(
      <ClientMoneyLedger
        data={{
          currencyTotals: [
            {
              currency: "USD",
              purchasedCents: 10_003,
              paidCents: 5_001,
              remainingCents: 5_002,
            },
          ],
          projects: [],
        }}
      />,
    );

    expect(html).toContain("$100.03");
    expect(html).toContain("$50.01");
    expect(html).toContain("$50.02");
  });
});
