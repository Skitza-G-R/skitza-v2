import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  buildTranzilaRedirectUrl: vi.fn(),
  createCaller: vi.fn(),
  getPaymentDetails: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
}));

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    mocks.redirect(target);
    throw new Error(`__REDIRECT__:${target}`);
  },
}));

vi.mock("~/lib/tranzila", () => ({
  buildTranzilaRedirectUrl: mocks.buildTranzilaRedirectUrl,
}));

vi.mock("~/server/trpc/routers/_app", () => ({
  appRouter: {
    createCaller: mocks.createCaller,
  },
}));

import PaymentPage from "../page";

const BOOKING_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.buildTranzilaRedirectUrl.mockReset();
  mocks.createCaller.mockReset();
  mocks.getPaymentDetails.mockReset();
  mocks.redirect.mockReset();

  mocks.auth.mockResolvedValue({ userId: "user_artist" });
  mocks.buildTranzilaRedirectUrl.mockReturnValue(
    "https://direct.tranzila.com/live-terminal/iframenew.php?sum=500.00",
  );
  mocks.getPaymentDetails.mockResolvedValue({
    booking: {
      id: BOOKING_ID,
      startsAt: new Date("2026-07-20T12:00:00.000Z"),
      durationMin: 60,
      packageName: "Production session",
      artistEmail: "artist@example.com",
      artistName: "Artist",
    },
    product: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Production session",
      priceCents: 50_000,
    },
    amountCents: 50_000,
    currency: "ILS",
    producerName: "North Studio",
    planKind: "upfront",
    planLabel: "Pay in full",
  });
  mocks.createCaller.mockReturnValue({
    payment: { getPaymentDetails: mocks.getPaymentDetails },
  });
});

describe("artist legacy booking payment route containment", () => {
  it("renders off-app instructions without building or redirecting to a card charge", async () => {
    const ui = await PaymentPage({
      params: Promise.resolve({ bookingId: BOOKING_ID }),
    });
    const html = renderToStaticMarkup(ui);

    expect(mocks.getPaymentDetails).toHaveBeenCalledWith({ bookingId: BOOKING_ID });
    expect(mocks.buildTranzilaRedirectUrl).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(html).toContain("Card payment is unavailable");
    expect(html).toContain("No card payment will be started from this page");
    expect(html).toContain("North Studio");
    expect(html).not.toContain("direct.tranzila.com");

    const source = readFileSync(join(__dirname, "../page.tsx"), "utf8");
    expect(source).not.toMatch(/buildTranzilaRedirectUrl|direct\.tranzila\.com|iframenew\.php/);
  });

  it("removes the failed-payment retry link that could re-enter card checkout", async () => {
    const ui = await PaymentPage({
      params: Promise.resolve({ bookingId: BOOKING_ID }),
      searchParams: Promise.resolve({ error: "payment_failed" }),
    });
    const html = renderToStaticMarkup(ui);

    expect(mocks.buildTranzilaRedirectUrl).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(html).toContain("Card payment is unavailable");
    expect(html).not.toContain("Try again");
    expect(html).not.toContain(`href="/artist/payment/${BOOKING_ID}"`);
    expect(html).not.toContain("direct.tranzila.com");
  });
});
