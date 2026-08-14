import { beforeEach, describe, expect, it, vi } from "vitest";

const OFFER_ID = "00000000-0000-4000-8000-000000000219";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000001";
const CLIENT_ID = "00000000-0000-4000-8000-000000000002";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000003";

const { createPrivateOfferMock, dbMock, producersMarker, sendEmailMock } = vi.hoisted(() => {
  const createPrivateOfferMock = vi.fn();
  const sendEmailMock = vi.fn();
  const producersMarker = {
    id: { column: "producers.id" },
    clerkUserId: { column: "producers.clerk_user_id" },
    closedAt: { column: "producers.closed_at" },
  };
  const dbMock = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ id: PRODUCER_ID }]),
        }),
      }),
    }),
  };
  return { createPrivateOfferMock, dbMock, producersMarker, sendEmailMock };
});

vi.mock("@skitza/db", () => ({
  and: (...conditions: unknown[]) => ({ conditions }),
  createDb: () => dbMock,
  eq: (column: unknown, value: unknown) => ({ column, value }),
  isNull: (column: unknown) => ({ column, operator: "is-null" }),
  producers: producersMarker,
}));

vi.mock("~/server/auth/verified-email", () => ({
  currentVerifiedEmailHashes: () => Promise.resolve([]),
}));

vi.mock("~/server/domain/private-offers/db", () => {
  class PrivateOfferPersistenceError extends Error {
    readonly code: string;

    constructor(code: string) {
      super("This offer is unavailable.");
      this.code = code;
    }
  }

  return {
    acceptPrivateOffer: vi.fn(),
    cancelPrivateOffer: vi.fn(),
    createPrivateOffer: createPrivateOfferMock,
    getArtistPrivateOffer: vi.fn(),
    listArtistPrivateOffers: vi.fn(),
    listPrivateOfferProjectOptions: vi.fn(),
    listPrivateOfferRecipients: vi.fn(),
    listProducerPrivateOffers: vi.fn(),
    notifyProducerOfPrivateOfferAcceptance: vi.fn(),
    PrivateOfferPersistenceError,
    rejectPrivateOffer: vi.fn(),
    updatePrivateOffer: vi.fn(),
  };
});

vi.mock("~/server/domain/private-offers/service", () => {
  class PrivateOfferDomainError extends Error {
    readonly code: string;

    constructor(code: string) {
      super("Invalid private offer.");
      this.code = code;
    }
  }

  return { PrivateOfferDomainError };
});

vi.mock("~/server/email/send", () => ({
  sendPrivateOfferNotificationEmail: async (...args: unknown[]): Promise<void> => {
    await sendEmailMock(...args);
  },
}));

import { privateOffersRouter } from "../private-offers";

function sendInput() {
  return {
    offerId: OFFER_ID,
    sourceProductId: PRODUCT_ID,
    recipient: { kind: "existing" as const, clientContactId: CLIENT_ID },
    target: { kind: "new" as const },
    terms: {
      name: "Idempotent private offer",
      service: "Production",
      deliverables: ["Final mix"],
      cashPriceCents: 10_000,
      currency: "USD",
      taxMode: "tax_free" as const,
      taxRatePct: 0,
      includedSongSpaces: 1,
      session: null,
      revisionRule: { kind: "fixed" as const, count: 1 },
      royaltyTerms: {
        master: { mode: "none" as const },
        composition: { mode: "none" as const },
      },
      rights: ["Artist may release the final master."],
      enabledPaymentPlans: [{ kind: "full" as const }],
      agreementText: "Exact private-offer terms.",
    },
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  };
}

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://test/test";
  createPrivateOfferMock.mockReset();
  sendEmailMock.mockReset().mockResolvedValue(undefined);
});

describe("privateOffers.send idempotency", () => {
  it("requires and forwards the client-generated offer UUID", async () => {
    createPrivateOfferMock.mockResolvedValue({
      created: true,
      offer: { id: OFFER_ID },
      recipient: { name: "Maya", email: "maya@example.test" },
      producer: { displayName: "Studio", slug: "studio" },
    });
    const caller = privateOffersRouter.createCaller({ userId: "producer-user" });

    const result = await caller.send(sendInput());

    expect(createPrivateOfferMock).toHaveBeenCalledWith(
      dbMock,
      expect.objectContaining({ offerId: OFFER_ID, producerId: PRODUCER_ID }),
    );
    expect(createPrivateOfferMock).toHaveBeenCalledWith(
      dbMock,
      expect.objectContaining({ sourceProductId: PRODUCT_ID }),
    );
    expect(result).toEqual({ offerId: OFFER_ID, emailDelivered: true });
  });

  it("does not send a second notification when the committed offer is replayed", async () => {
    createPrivateOfferMock
      .mockResolvedValueOnce({
        created: true,
        offer: { id: OFFER_ID },
        recipient: { name: "Maya", email: "maya@example.test" },
        producer: { displayName: "Studio", slug: "studio" },
      })
      .mockResolvedValueOnce({ created: false, offer: { id: OFFER_ID } });
    const caller = privateOffersRouter.createCaller({ userId: "producer-user" });

    const first = await caller.send(sendInput());
    const replay = await caller.send(sendInput());

    expect(first).toEqual({ offerId: OFFER_ID, emailDelivered: true });
    expect(replay).toEqual({ offerId: OFFER_ID, emailDelivered: null });
    expect(createPrivateOfferMock).toHaveBeenCalledTimes(2);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("reports an initial notification failure without retrying email on replay", async () => {
    createPrivateOfferMock
      .mockResolvedValueOnce({
        created: true,
        offer: { id: OFFER_ID },
        recipient: { name: "Maya", email: "maya@example.test" },
        producer: { displayName: "Studio", slug: "studio" },
      })
      .mockResolvedValueOnce({ created: false, offer: { id: OFFER_ID } });
    sendEmailMock.mockRejectedValueOnce(new Error("email unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const caller = privateOffersRouter.createCaller({ userId: "producer-user" });

    const first = await caller.send(sendInput());
    const replay = await caller.send(sendInput());

    expect(first).toEqual({ offerId: OFFER_ID, emailDelivered: false });
    expect(replay).toEqual({ offerId: OFFER_ID, emailDelivered: null });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("rejects a missing or malformed request identity before creation", async () => {
    const caller = privateOffersRouter.createCaller({ userId: "producer-user" });
    const withoutOfferId: Partial<ReturnType<typeof sendInput>> = { ...sendInput() };
    delete withoutOfferId.offerId;

    await expect(caller.send(withoutOfferId as never)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(caller.send({ ...sendInput(), offerId: "not-a-uuid" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(createPrivateOfferMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
