import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  buildTranzilaRedirectUrl: vi.fn(),
  confirmAfterPayment: vi.fn(),
  createCaller: vi.fn(),
  recentConfirmedBooking: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
}));

vi.mock("~/lib/tranzila", () => ({
  buildTranzilaRedirectUrl: mocks.buildTranzilaRedirectUrl,
}));

vi.mock("~/server/trpc/routers/_app", () => ({
  appRouter: {
    createCaller: mocks.createCaller,
  },
}));

import PaymentSuccessPage from "../page";

function expectFailClosedCopy(html: string) {
  expect(html).toContain("Card payment cannot be confirmed here");
  expect(html).toContain("Skitza does not process card payments");
  expect(html).toContain("Ask your producer");
  expect(html).toContain("Opening this page did not start or change a payment or booking");
  expect(html).not.toMatch(/payment confirmed/i);
  expect(html).not.toMatch(/session (?:has been |is )?booked/i);
  expect(html).not.toMatch(/href="https?:|<form/i);
}

async function renderSuccessPage(): Promise<string> {
  const page = await Promise.resolve(PaymentSuccessPage());
  return renderToStaticMarkup(page);
}

beforeEach(() => {
  mocks.auth.mockReset();
  mocks.buildTranzilaRedirectUrl.mockReset();
  mocks.confirmAfterPayment.mockReset();
  mocks.createCaller.mockReset();
  mocks.recentConfirmedBooking.mockReset();

  mocks.createCaller.mockReturnValue({
    artist: { recentConfirmedBooking: mocks.recentConfirmedBooking },
    booking: { confirmAfterPayment: mocks.confirmAfterPayment },
  });
});

describe("legacy Tranzila success return containment", () => {
  it("does not claim payment or booking confirmation for a direct unauthenticated visit", async () => {
    mocks.auth.mockResolvedValue({ userId: null });

    const html = await renderSuccessPage();

    expectFailClosedCopy(html);
    expect(mocks.createCaller).not.toHaveBeenCalled();
  });

  it("does not infer a card confirmation from an authenticated recent booking", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_artist" });
    mocks.recentConfirmedBooking.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      startsAt: new Date("2026-07-20T12:00:00.000Z"),
      durationMin: 60,
      packageNameSnapshot: "Production session",
      tranzilaConfirmationCode: "forged-code",
      producerName: "North Studio",
    });

    const html = await renderSuccessPage();

    expectFailClosedCopy(html);
    expect(html).not.toContain("forged-code");
    expect(html).not.toContain("North Studio");
    expect(mocks.createCaller).not.toHaveBeenCalled();
  });

  it("does not claim success for an authenticated visitor without a recent booking", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_artist" });
    mocks.recentConfirmedBooking.mockResolvedValue(null);

    const html = await renderSuccessPage();

    expectFailClosedCopy(html);
    expect(mocks.createCaller).not.toHaveBeenCalled();
  });

  it("stays read-only and inert across concurrent direct visits", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_artist" });
    mocks.recentConfirmedBooking.mockResolvedValue(null);

    const pages = await Promise.all(Array.from({ length: 8 }, () => renderSuccessPage()));

    for (const html of pages) {
      expectFailClosedCopy(html);
      expect(html).not.toMatch(/direct\.tranzila\.com|iframenew\.php/i);
    }
    expect(mocks.createCaller).not.toHaveBeenCalled();
    expect(mocks.recentConfirmedBooking).not.toHaveBeenCalled();
    expect(mocks.confirmAfterPayment).not.toHaveBeenCalled();
    expect(mocks.buildTranzilaRedirectUrl).not.toHaveBeenCalled();

    const source = readFileSync(join(__dirname, "../page.tsx"), "utf8");
    expect(source).not.toMatch(
      /appRouter|recentConfirmedBooking|confirmAfterPayment|buildTranzilaRedirectUrl|direct\.tranzila\.com|iframenew\.php|redirect\(/,
    );
  });
});
