import { beforeEach, describe, expect, it, vi } from "vitest";

const { createCallerMock, confirmAfterPaymentMock } = vi.hoisted(() => ({
  createCallerMock: vi.fn(),
  confirmAfterPaymentMock: vi.fn(),
}));

vi.mock("~/server/trpc/routers/_app", () => ({
  appRouter: {
    createCaller: createCallerMock,
  },
}));

import { POST } from "./route";

const BOOKING_ID = "00000000-0000-4000-8000-000000000100";

function forgedCallbackRequest(): Request {
  return new Request("https://skitza.test/api/tranzila/callback", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      Response: "000",
      pdesc: BOOKING_ID,
      ConfirmationCode: "forged-confirmation",
    }),
  });
}

beforeEach(() => {
  confirmAfterPaymentMock.mockReset().mockResolvedValue({ ok: true });
  createCallerMock.mockReset().mockReturnValue({
    booking: { confirmAfterPayment: confirmAfterPaymentMock },
  });
});

describe("disabled legacy Tranzila callback", () => {
  it("never confirms payment from a supplied booking id", async () => {
    const response = await POST(forgedCallbackRequest());

    expect(response.status).toBe(200);
    expect(createCallerMock).not.toHaveBeenCalled();
    expect(confirmAfterPaymentMock).not.toHaveBeenCalled();
  });

  it("stays inert under concurrent forged callbacks and replays", async () => {
    const responses = await Promise.all(
      Array.from({ length: 24 }, () => POST(forgedCallbackRequest())),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(createCallerMock).not.toHaveBeenCalled();
    expect(confirmAfterPaymentMock).not.toHaveBeenCalled();
  });
});
