import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionBookingDomainError } from "~/server/domain/session-booking/service";

// SK-90/SK-68 confirmation is a thin producer-owned adapter around the
// lifecycle command. Purchase/project/allowance locking and transition
// behavior are covered by the domain and repository contract suites.

const PRODUCER_ID = "producer-uuid-confirm";
const BOOKING_ID = "00000000-0000-0000-0000-000000000c01";
const PURCHASE_ID = "00000000-0000-0000-0000-000000000c02";
const PROJECT_ID = "00000000-0000-0000-0000-000000000c03";
const ALLOWANCE_ID = "00000000-0000-0000-0000-000000000c04";
const USER_ID = "user_test_confirm";

const {
  producersMarker,
  productsMarker,
  projectsMarker,
  bookingsMarker,
  clientContactsMarker,
  purchasesMarker,
  purchaseSessionAllowancesMarker,
  purchasePaymentsMarker,
  messageRows,
  messageWhereCalls,
  afterCallbacks,
  sendBookingConfirmedEmailMock,
  confirmSessionBookingMock,
  dbMock,
} = vi.hoisted(() => {
  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    clerkUserId: { __column: "producers.clerk_user_id" },
    displayName: { __column: "producers.display_name" },
    timezone: { __column: "producers.timezone" },
  };
  const productsMarker = { __table: "products", id: { __column: "products.id" } };
  const projectsMarker = {
    __table: "projects",
    id: { __column: "projects.id" },
    producerId: { __column: "projects.producer_id" },
    clientContactId: { __column: "projects.client_contact_id" },
    lifecycleStatus: { __column: "projects.lifecycle_status" },
  };
  const bookingsMarker = {
    __table: "bookings",
    id: { __column: "bookings.id" },
    producerId: { __column: "bookings.producer_id" },
    projectId: { __column: "bookings.project_id" },
    purchaseId: { __column: "bookings.purchase_id" },
    sessionAllowanceId: { __column: "bookings.session_allowance_id" },
    status: { __column: "bookings.status" },
  };
  const clientContactsMarker = { __table: "client_contacts" };
  const purchasesMarker = {
    __table: "purchases",
    id: { __column: "purchases.id" },
    projectId: { __column: "purchases.project_id" },
    producerId: { __column: "purchases.producer_id" },
    clientContactId: { __column: "purchases.client_contact_id" },
    lifecycleStatus: { __column: "purchases.lifecycle_status" },
    commercialSnapshot: { __column: "purchases.commercial_snapshot" },
  };
  const purchaseSessionAllowancesMarker = {
    __table: "purchase_session_allowances",
    id: { __column: "purchase_session_allowances.id" },
    purchaseId: { __column: "purchase_session_allowances.purchase_id" },
    producerId: { __column: "purchase_session_allowances.producer_id" },
    closedAt: { __column: "purchase_session_allowances.closed_at" },
  };
  const purchasePaymentsMarker = { __table: "purchase_payments" };
  const messageRows: Record<string, unknown>[] = [];
  const messageWhereCalls: unknown[] = [];
  const afterCallbacks: Array<() => Promise<void>> = [];
  const sendBookingConfirmedEmailMock = vi
    .fn<(to: string, props: Record<string, unknown>) => Promise<void>>()
    .mockResolvedValue(undefined);
  const confirmSessionBookingMock = vi.fn();

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === producersMarker) {
          return {
            where: () => ({ limit: () => Promise.resolve([{ id: PRODUCER_ID }]) }),
          };
        }
        if (table !== bookingsMarker) throw new Error("unexpected outer select");
        type SelectLink = {
          innerJoin: () => SelectLink;
          where: (where: unknown) => SelectLink;
          limit: () => Promise<Record<string, unknown>[]>;
        };
        const link: SelectLink = {
          innerJoin: () => link,
          where: (where) => {
            messageWhereCalls.push(where);
            return link;
          },
          limit: () => Promise.resolve([...messageRows]),
        };
        return link;
      },
    }),
  };

  return {
    producersMarker,
    productsMarker,
    projectsMarker,
    bookingsMarker,
    clientContactsMarker,
    purchasesMarker,
    purchaseSessionAllowancesMarker,
    purchasePaymentsMarker,
    messageRows,
    messageWhereCalls,
    afterCallbacks,
    sendBookingConfirmedEmailMock,
    confirmSessionBookingMock,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: USER_ID }),
}));

vi.mock("next/server", () => ({
  after: (callback: () => Promise<void>) => {
    afterCallbacks.push(callback);
  },
}));

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  products: productsMarker,
  projects: projectsMarker,
  bookings: bookingsMarker,
  clientContacts: clientContactsMarker,
  purchases: purchasesMarker,
  purchaseSessionAllowances: purchaseSessionAllowancesMarker,
  purchasePayments: purchasePaymentsMarker,
  availabilityBlackouts: { __table: "availability_blackouts" },
  availabilityBlocks: { __table: "availability_blocks" },
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  or: (...conditions: unknown[]) => ({ or: conditions }),
  asc: (column: unknown) => ({ asc: column }),
  desc: (column: unknown) => ({ desc: column }),
  isNull: (column: unknown) => ({ isNull: column }),
  gte: (column: unknown, value: unknown) => ({ gte: [column, value] }),
  lte: (column: unknown, value: unknown) => ({ lte: [column, value] }),
  inArray: (column: unknown, values: unknown[]) => ({ inArray: [column, values] }),
  sql: () => ({ sql: true }),
}));

vi.mock("~/server/domain/session-booking/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/domain/session-booking/service")>();
  return { ...actual, confirmSessionBooking: confirmSessionBookingMock };
});

vi.mock("~/server/email/send", () => ({
  sendBookingCancelledOrRescheduledEmail: vi.fn(() => Promise.resolve()),
  sendBookingConfirmedEmail: sendBookingConfirmedEmailMock,
}));

function findPredicate(where: unknown, columnMarker: unknown): unknown {
  if (!where || typeof where !== "object") return null;
  if ("and" in where && Array.isArray((where as { and: unknown[] }).and)) {
    for (const predicate of (where as { and: unknown[] }).and) {
      const found = findPredicate(predicate, columnMarker);
      if (found) return found;
    }
    return null;
  }
  if ("eq" in where) {
    const args = (where as { eq: unknown }).eq;
    if (Array.isArray(args) && args[0] === columnMarker) return args;
  }
  return null;
}

function seedMessageContext(): void {
  messageRows.push({
    booking: {
      id: BOOKING_ID,
      producerId: PRODUCER_ID,
      purchaseId: PURCHASE_ID,
      projectId: PROJECT_ID,
      sessionAllowanceId: ALLOWANCE_ID,
      artistEmail: "artist@example.test",
      artistName: "Artist",
      startsAt: new Date("2035-02-03T10:00:00.000Z"),
    },
    commercialSnapshot: { productOrOfferName: "Purchased vocal session" },
    producerDisplayName: "Producer",
    producerTimezone: "Asia/Jerusalem",
  });
}

beforeEach(() => {
  messageRows.length = 0;
  messageWhereCalls.length = 0;
  afterCallbacks.length = 0;
  sendBookingConfirmedEmailMock.mockClear();
  confirmSessionBookingMock.mockReset();
  confirmSessionBookingMock.mockResolvedValue({
    changed: true,
    booking: { id: BOOKING_ID, status: "confirmed" },
  });
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: USER_ID });
};

const confirmInput = { id: BOOKING_ID, operationKey: `producer-confirm:${BOOKING_ID}:v1` };

describe("booking.confirm purchase-owned boundary", () => {
  it("producer-scopes the preload and delegates the durable command identity", async () => {
    seedMessageContext();
    const caller = await buildCaller();

    await expect(caller.booking.confirm(confirmInput)).resolves.toEqual({
      ok: true,
      id: BOOKING_ID,
      status: "confirmed",
    });

    expect(findPredicate(messageWhereCalls[0], bookingsMarker.id)).toEqual([
      bookingsMarker.id,
      BOOKING_ID,
    ]);
    expect(findPredicate(messageWhereCalls[0], bookingsMarker.producerId)).toEqual([
      bookingsMarker.producerId,
      PRODUCER_ID,
    ]);
    expect(confirmSessionBookingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bookingId: BOOKING_ID,
        producerId: PRODUCER_ID,
        actorClerkUserId: USER_ID,
        operationKey: confirmInput.operationKey,
      }),
    );
  });

  it("sends one best-effort confirmation only after a new transition", async () => {
    seedMessageContext();
    const caller = await buildCaller();

    await caller.booking.confirm(confirmInput);
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]?.();

    expect(sendBookingConfirmedEmailMock).toHaveBeenCalledWith(
      "artist@example.test",
      expect.objectContaining({
        artistName: "Artist",
        producerName: "Producer",
        productName: "Purchased vocal session",
        producerTimezone: "Asia/Jerusalem",
      }),
    );
  });

  it("does not notify again for an idempotent replay", async () => {
    seedMessageContext();
    confirmSessionBookingMock.mockResolvedValueOnce({
      changed: false,
      booking: { id: BOOKING_ID, status: "confirmed" },
    });

    await (await buildCaller()).booking.confirm(confirmInput);

    expect(afterCallbacks).toEqual([]);
    expect(sendBookingConfirmedEmailMock).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND without invoking the command when the producer-scoped preload misses", async () => {
    await expect((await buildCaller()).booking.confirm(confirmInput)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(confirmSessionBookingMock).not.toHaveBeenCalled();
  });

  it("maps operation-key reuse to a conflict", async () => {
    seedMessageContext();
    confirmSessionBookingMock.mockRejectedValueOnce(
      new SessionBookingDomainError("OPERATION_KEY_CONFLICT", "key already used"),
    );

    await expect((await buildCaller()).booking.confirm(confirmInput)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(afterCallbacks).toEqual([]);
  });
});
