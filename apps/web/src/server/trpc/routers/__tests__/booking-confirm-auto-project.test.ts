import { beforeEach, describe, expect, it, vi } from "vitest";

// SK-90 confirmation is a guarded status transition on an already-owned
// booking. It must resolve one active purchase, its active project, and the
// booking's open purchase session allowance in the same transaction. It must
// never auto-create a project/contact or synthesize payment history.

const PRODUCER_ID = "producer-uuid-confirm";
const BOOKING_ID = "00000000-0000-0000-0000-000000000c01";
const PURCHASE_ID = "00000000-0000-0000-0000-000000000c02";
const PROJECT_ID = "00000000-0000-0000-0000-000000000c03";
const ALLOWANCE_ID = "00000000-0000-0000-0000-000000000c04";

type Row = Record<string, unknown>;

const {
  producersMarker,
  productsMarker,
  projectsMarker,
  bookingsMarker,
  clientContactsMarker,
  purchasesMarker,
  purchaseSessionAllowancesMarker,
  purchasePaymentsMarker,
  selectRows,
  updateReturningRows,
  selectWhereCalls,
  joinCalls,
  insertCalls,
  updateCalls,
  forUpdateCalls,
  afterCallbacks,
  sendBookingConfirmedEmailMock,
  transactionSpy,
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

  const selectRows: Row[] = [];
  const updateReturningRows: Row[] = [];
  const selectWhereCalls: unknown[] = [];
  const joinCalls: Array<{ table: unknown; on: unknown }> = [];
  const insertCalls: Array<{ table: unknown; values: unknown }> = [];
  const updateCalls: Array<{ table: unknown; set: Row; where?: unknown }> = [];
  const forUpdateCalls: string[] = [];
  const afterCallbacks: Array<() => Promise<void>> = [];
  const sendBookingConfirmedEmailMock = vi
    .fn<(to: string, props: Record<string, unknown>) => Promise<void>>()
    .mockResolvedValue(undefined);

  const txMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table !== bookingsMarker) throw new Error("unexpected transaction select");
        type SelectLink = {
          innerJoin: (joinTable: unknown, on: unknown) => SelectLink;
          where: (where: unknown) => SelectLink;
          for: (mode: string) => SelectLink;
          limit: () => Promise<Row[]>;
        };
        const link: SelectLink = {
          innerJoin: (joinTable: unknown, on: unknown) => {
            joinCalls.push({ table: joinTable, on });
            return link;
          },
          where: (where: unknown) => {
            selectWhereCalls.push(where);
            return link;
          },
          for: (mode: string) => {
            forUpdateCalls.push(mode);
            return link;
          },
          limit: () => Promise.resolve([...selectRows]),
        };
        return link;
      },
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        insertCalls.push({ table, values });
        return Promise.resolve(undefined);
      },
    }),
    update: (table: unknown) => ({
      set: (set: Row) => {
        const record: { table: unknown; set: Row; where?: unknown } = { table, set };
        updateCalls.push(record);
        return {
          where: (where: unknown) => {
            record.where = where;
            return {
              returning: () => Promise.resolve([...updateReturningRows]),
            };
          },
        };
      },
    }),
  };

  const transactionSpy = vi.fn(async (callback: (tx: typeof txMock) => Promise<unknown>) =>
    callback(txMock),
  );

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table !== producersMarker) throw new Error("unexpected outer select");
        return {
          where: () => ({
            limit: () => Promise.resolve([{ id: PRODUCER_ID }]),
          }),
        };
      },
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        insertCalls.push({ table, values });
        return Promise.resolve(undefined);
      },
    }),
    transaction: transactionSpy,
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
    selectRows,
    updateReturningRows,
    selectWhereCalls,
    joinCalls,
    insertCalls,
    updateCalls,
    forUpdateCalls,
    afterCallbacks,
    sendBookingConfirmedEmailMock,
    transactionSpy,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_confirm" }),
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

function seedExisting(overrides: Partial<Row> = {}): void {
  selectRows.push({
    booking: {
      id: BOOKING_ID,
      producerId: PRODUCER_ID,
      purchaseId: PURCHASE_ID,
      projectId: PROJECT_ID,
      sessionAllowanceId: ALLOWANCE_ID,
      status: "pending_approval",
      artistEmail: "artist@example.test",
      artistName: "Artist",
      startsAt: new Date("2035-02-03T10:00:00.000Z"),
    },
    commercialSnapshot: { productOrOfferName: "Purchased vocal session" },
    purchaseLifecycleStatus: "active",
    projectLifecycleStatus: "active",
    allowanceClosedAt: null,
    producerDisplayName: "Producer",
    producerTimezone: "Asia/Jerusalem",
    ...overrides,
  });
}

beforeEach(() => {
  selectRows.length = 0;
  updateReturningRows.length = 0;
  updateReturningRows.push({ id: BOOKING_ID });
  selectWhereCalls.length = 0;
  joinCalls.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
  forUpdateCalls.length = 0;
  afterCallbacks.length = 0;
  sendBookingConfirmedEmailMock.mockClear();
  transactionSpy.mockClear();
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async (userId: string | null = "user_test_confirm") => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId });
};

describe("booking.confirm purchase-owned boundary", () => {
  it("confirms only the booking and creates no project, contact, or payment rows", async () => {
    seedExisting();
    const caller = await buildCaller();

    await expect(caller.booking.confirm({ id: BOOKING_ID })).resolves.toEqual({ ok: true });

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(forUpdateCalls).toEqual(["update"]);
    expect(insertCalls).toEqual([]);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.table).toBe(bookingsMarker);
    expect(updateCalls[0]?.set).toMatchObject({ status: "confirmed" });
    expect(updateCalls[0]?.set["statusChangedAt"]).toBeInstanceOf(Date);
    expect(updateCalls.some((call) => call.table === projectsMarker)).toBe(false);
    expect(insertCalls.some((call) => call.table === clientContactsMarker)).toBe(false);
    expect(insertCalls.some((call) => call.table === purchasePaymentsMarker)).toBe(false);
  });

  it("sends one best-effort confirmation from purchase terms only after a new transition", async () => {
    seedExisting();
    const caller = await buildCaller();

    await caller.booking.confirm({ id: BOOKING_ID });
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]?.();

    expect(sendBookingConfirmedEmailMock).toHaveBeenCalledTimes(1);
    expect(sendBookingConfirmedEmailMock).toHaveBeenCalledWith(
      "artist@example.test",
      expect.objectContaining({
        artistName: "Artist",
        producerName: "Producer",
        productName: "Purchased vocal session",
        producerTimezone: "Asia/Jerusalem",
      }),
    );
    expect(sendBookingConfirmedEmailMock.mock.calls[0]?.[1]).not.toHaveProperty(
      "depositCents",
    );
    expect(sendBookingConfirmedEmailMock.mock.calls[0]?.[1]).not.toHaveProperty(
      "priceCents",
    );
  });

  it("joins the booking to its exact purchase, project, and session allowance", async () => {
    seedExisting();
    const caller = await buildCaller();
    await caller.booking.confirm({ id: BOOKING_ID });

    expect(joinCalls.map((call) => call.table)).toEqual([
      purchasesMarker,
      projectsMarker,
      purchaseSessionAllowancesMarker,
      producersMarker,
    ]);

    const purchaseJoin = joinCalls[0]?.on;
    expect(findPredicate(purchaseJoin, purchasesMarker.id)).toEqual([
      purchasesMarker.id,
      bookingsMarker.purchaseId,
    ]);
    expect(findPredicate(purchaseJoin, purchasesMarker.projectId)).toEqual([
      purchasesMarker.projectId,
      bookingsMarker.projectId,
    ]);
    expect(findPredicate(purchaseJoin, purchasesMarker.producerId)).toEqual([
      purchasesMarker.producerId,
      bookingsMarker.producerId,
    ]);

    const projectJoin = joinCalls[1]?.on;
    expect(findPredicate(projectJoin, projectsMarker.id)).toEqual([
      projectsMarker.id,
      purchasesMarker.projectId,
    ]);
    expect(findPredicate(projectJoin, projectsMarker.producerId)).toEqual([
      projectsMarker.producerId,
      purchasesMarker.producerId,
    ]);
    expect(findPredicate(projectJoin, projectsMarker.clientContactId)).toEqual([
      projectsMarker.clientContactId,
      purchasesMarker.clientContactId,
    ]);

    const allowanceJoin = joinCalls[2]?.on;
    expect(findPredicate(allowanceJoin, purchaseSessionAllowancesMarker.id)).toEqual([
      purchaseSessionAllowancesMarker.id,
      bookingsMarker.sessionAllowanceId,
    ]);
    expect(findPredicate(allowanceJoin, purchaseSessionAllowancesMarker.purchaseId)).toEqual([
      purchaseSessionAllowancesMarker.purchaseId,
      bookingsMarker.purchaseId,
    ]);
    expect(findPredicate(allowanceJoin, purchaseSessionAllowancesMarker.producerId)).toEqual([
      purchaseSessionAllowancesMarker.producerId,
      bookingsMarker.producerId,
    ]);
  });

  it("producer-scopes both the lookup and compare-and-set update", async () => {
    seedExisting();
    const caller = await buildCaller();
    await caller.booking.confirm({ id: BOOKING_ID });

    const lookupWhere = selectWhereCalls[0];
    expect(findPredicate(lookupWhere, bookingsMarker.id)).toEqual([bookingsMarker.id, BOOKING_ID]);
    expect(findPredicate(lookupWhere, bookingsMarker.producerId)).toEqual([
      bookingsMarker.producerId,
      PRODUCER_ID,
    ]);

    const updateWhere = updateCalls[0]?.where;
    expect(findPredicate(updateWhere, bookingsMarker.id)).toEqual([bookingsMarker.id, BOOKING_ID]);
    expect(findPredicate(updateWhere, bookingsMarker.producerId)).toEqual([
      bookingsMarker.producerId,
      PRODUCER_ID,
    ]);
    expect(findPredicate(updateWhere, bookingsMarker.status)).toEqual([
      bookingsMarker.status,
      "pending_approval",
    ]);
  });

  it.each([
    {
      label: "purchase is not active",
      overrides: { purchaseLifecycleStatus: "waiting_for_payment" },
    },
    {
      label: "project is not active",
      overrides: { projectLifecycleStatus: "paused" },
    },
    {
      label: "allowance is closed",
      overrides: { allowanceClosedAt: new Date("2035-01-02T03:04:05.000Z") },
    },
  ])("rejects confirmation when the $label", async ({ overrides }) => {
    seedExisting(overrides);
    const caller = await buildCaller();

    await expect(caller.booking.confirm({ id: BOOKING_ID })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(updateCalls).toEqual([]);
    expect(insertCalls).toEqual([]);
  });

  it("is idempotent for an already-confirmed booking", async () => {
    seedExisting({
      booking: {
        id: BOOKING_ID,
        producerId: PRODUCER_ID,
        purchaseId: PURCHASE_ID,
        projectId: PROJECT_ID,
        sessionAllowanceId: ALLOWANCE_ID,
        status: "confirmed",
      },
    });
    const caller = await buildCaller();

    await expect(caller.booking.confirm({ id: BOOKING_ID })).resolves.toEqual({ ok: true });
    expect(updateCalls).toEqual([]);
    expect(insertCalls).toEqual([]);
    expect(afterCallbacks).toEqual([]);
    expect(sendBookingConfirmedEmailMock).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the producer-scoped join resolves no booking", async () => {
    const caller = await buildCaller();

    await expect(caller.booking.confirm({ id: BOOKING_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(updateCalls).toEqual([]);
    expect(insertCalls).toEqual([]);
  });

  it("reports a conflict when the compare-and-set update loses a race", async () => {
    seedExisting();
    updateReturningRows.length = 0;
    const caller = await buildCaller();

    await expect(caller.booking.confirm({ id: BOOKING_ID })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(insertCalls).toEqual([]);
  });
});
