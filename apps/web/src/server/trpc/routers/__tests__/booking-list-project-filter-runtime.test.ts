import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  PRODUCER_ID,
  PROJECT_ID,
  OTHER_PROJECT_ID,
  FOREIGN_PROJECT_ID,
  producers,
  bookings,
  bookingChangeRequests,
  purchases,
  createDb,
  bookingWherePredicates,
  bookingOrderColumns,
  findEqValue,
  resetObservations,
} = vi.hoisted(() => {
  const PRODUCER_ID = "00000000-0000-4000-8000-000000000145";
  const PROJECT_ID = "00000000-0000-4000-8000-000000000146";
  const OTHER_PROJECT_ID = "00000000-0000-4000-8000-000000000147";
  const FOREIGN_PRODUCER_ID = "00000000-0000-4000-8000-000000000245";
  const FOREIGN_PROJECT_ID = "00000000-0000-4000-8000-000000000246";

  const column = (name: string) => ({ __column: name });
  const producers = {
    __table: "producers",
    id: column("producers.id"),
    clerkUserId: column("producers.clerk_user_id"),
  };
  const bookings = {
    __table: "bookings",
    id: column("bookings.id"),
    producerId: column("bookings.producer_id"),
    projectId: column("bookings.project_id"),
    purchaseId: column("bookings.purchase_id"),
    status: column("bookings.status"),
    startsAt: column("bookings.starts_at"),
  };
  const purchases = {
    __table: "purchases",
    id: column("purchases.id"),
    producerId: column("purchases.producer_id"),
    projectId: column("purchases.project_id"),
    commercialSnapshot: column("purchases.commercial_snapshot"),
  };
  const bookingChangeRequests = {
    __table: "booking_change_requests",
    id: column("booking_change_requests.id"),
    bookingId: column("booking_change_requests.booking_id"),
    producerId: column("booking_change_requests.producer_id"),
    kind: column("booking_change_requests.kind"),
    status: column("booking_change_requests.status"),
    proposedStartsAt: column("booking_change_requests.proposed_starts_at"),
    requestedAt: column("booking_change_requests.requested_at"),
  };

  type Predicate =
    | { operator: "eq"; left: unknown; right: unknown }
    | { operator: "and"; conditions: Predicate[] };

  function findEqValue(predicate: unknown, targetColumn: unknown): unknown {
    if (!predicate || typeof predicate !== "object") return undefined;
    const candidate = predicate as Partial<Predicate> & {
      left?: unknown;
      right?: unknown;
      conditions?: Predicate[];
    };
    if (candidate.operator === "eq" && candidate.left === targetColumn) {
      return candidate.right;
    }
    if (candidate.operator === "and" && Array.isArray(candidate.conditions)) {
      for (const condition of candidate.conditions) {
        const value = findEqValue(condition, targetColumn);
        if (value !== undefined) return value;
      }
    }
    return undefined;
  }

  const earlyBooking = {
    id: "00000000-0000-4000-8000-000000000151",
    producerId: PRODUCER_ID,
    projectId: PROJECT_ID,
    purchaseId: "00000000-0000-4000-8000-000000000161",
    status: "confirmed",
    startsAt: new Date("2026-08-02T08:00:00.000Z"),
    durationMin: 90,
    artistName: "Early Artist",
  };
  const pendingBooking = {
    id: "00000000-0000-4000-8000-000000000152",
    producerId: PRODUCER_ID,
    projectId: PROJECT_ID,
    purchaseId: "00000000-0000-4000-8000-000000000162",
    status: "pending_approval",
    startsAt: new Date("2026-08-03T08:00:00.000Z"),
    durationMin: 60,
    artistName: "Pending Artist",
  };
  const lateBooking = {
    id: "00000000-0000-4000-8000-000000000153",
    producerId: PRODUCER_ID,
    projectId: PROJECT_ID,
    purchaseId: "00000000-0000-4000-8000-000000000163",
    status: "confirmed",
    startsAt: new Date("2026-08-04T08:00:00.000Z"),
    durationMin: 120,
    artistName: "Late Artist",
  };
  const otherProjectBooking = {
    id: "00000000-0000-4000-8000-000000000154",
    producerId: PRODUCER_ID,
    projectId: OTHER_PROJECT_ID,
    purchaseId: "00000000-0000-4000-8000-000000000164",
    status: "confirmed",
    startsAt: new Date("2026-08-01T08:00:00.000Z"),
    durationMin: 45,
    artistName: "Other Project Artist",
  };
  const foreignBooking = {
    id: "00000000-0000-4000-8000-000000000155",
    producerId: FOREIGN_PRODUCER_ID,
    projectId: FOREIGN_PROJECT_ID,
    purchaseId: "00000000-0000-4000-8000-000000000165",
    status: "confirmed",
    startsAt: new Date("2026-08-01T07:00:00.000Z"),
    durationMin: 30,
    artistName: "Foreign Artist",
  };

  const joinedRows = [
    {
      booking: lateBooking,
      commercialSnapshot: {
        productOrOfferName: "",
        lineItems: [],
      },
    },
    {
      booking: earlyBooking,
      commercialSnapshot: {
        productOrOfferName: "Vocal production",
        lineItems: [
          { quantity: 2, unitPriceCents: 15_000 },
          { quantity: 1, unitPriceCents: 5_000 },
        ],
      },
    },
    {
      booking: pendingBooking,
      commercialSnapshot: {
        productOrOfferName: "Mix review",
        lineItems: [{ quantity: 1, unitPriceCents: 8_000 }],
      },
    },
    {
      booking: otherProjectBooking,
      commercialSnapshot: {
        productOrOfferName: "Other project",
        lineItems: [{ quantity: 1, unitPriceCents: 7_000 }],
      },
    },
    {
      booking: foreignBooking,
      commercialSnapshot: {
        productOrOfferName: "Foreign package",
        lineItems: [{ quantity: 99, unitPriceCents: 99_000 }],
      },
    },
  ];

  const bookingWherePredicates: unknown[] = [];
  const bookingOrderColumns: unknown[] = [];

  function bookingRowsFor(predicate: unknown) {
    const producerId = findEqValue(predicate, bookings.producerId);
    const projectId = findEqValue(predicate, bookings.projectId);
    const status = findEqValue(predicate, bookings.status);
    return joinedRows
      .filter(({ booking }) => {
        if (producerId !== undefined && booking.producerId !== producerId) return false;
        if (projectId !== undefined && booking.projectId !== projectId) return false;
        if (status !== undefined && booking.status !== status) return false;
        return true;
      })
      .sort((left, right) => left.booking.startsAt.getTime() - right.booking.startsAt.getTime());
  }

  function selectFrom(table: unknown) {
    let predicate: unknown;
    let result: Promise<Record<string, unknown>[]> | undefined;
    const resolve = () => {
      result ??= Promise.resolve(
        table === producers
          ? [{ id: PRODUCER_ID }]
          : table === bookings
            ? bookingRowsFor(predicate)
            : [],
      );
      return result;
    };
    const query = {
      innerJoin: () => query,
      leftJoin: () => query,
      where: (value: unknown) => {
        predicate = value;
        if (table === bookings) bookingWherePredicates.push(value);
        return query;
      },
      orderBy: (value: unknown) => {
        if (table === bookings) bookingOrderColumns.push(value);
        return query;
      },
      limit: () => resolve(),
      then: <TResult1 = Record<string, unknown>[], TResult2 = never>(
        onfulfilled?:
          | ((value: Record<string, unknown>[]) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): PromiseLike<TResult1 | TResult2> => resolve().then(onfulfilled, onrejected),
    };
    return query;
  }

  const dbMock = {
    select: () => ({ from: selectFrom }),
  };
  const createDb = vi.fn(() => dbMock);

  function resetObservations() {
    createDb.mockClear();
    bookingWherePredicates.length = 0;
    bookingOrderColumns.length = 0;
  }

  return {
    PRODUCER_ID,
    PROJECT_ID,
    OTHER_PROJECT_ID,
    FOREIGN_PROJECT_ID,
    producers,
    bookings,
    bookingChangeRequests,
    purchases,
    createDb,
    bookingWherePredicates,
    bookingOrderColumns,
    findEqValue,
    resetObservations,
  };
});

vi.mock("@skitza/db", () => ({
  createDb,
  producers,
  bookings,
  bookingChangeRequests,
  purchases,
  products: { __table: "products" },
  projects: { __table: "projects" },
  privateOffers: { __table: "private_offers" },
  purchaseRequests: { __table: "purchase_requests" },
  availabilityBlackouts: { __table: "availability_blackouts" },
  availabilityBlocks: { __table: "availability_blocks" },
  eq: (left: unknown, right: unknown) => ({ operator: "eq", left, right }),
  and: (...conditions: unknown[]) => ({
    operator: "and",
    conditions: conditions.filter((condition) => condition !== undefined),
  }),
  asc: (column: unknown) => ({ direction: "asc", column }),
  desc: (column: unknown) => ({ direction: "desc", column }),
  gte: (left: unknown, right: unknown) => ({ operator: "gte", left, right }),
  inArray: (left: unknown, right: unknown[]) => ({ operator: "inArray", left, right }),
  isNull: (column: unknown) => ({ operator: "isNull", column }),
  lte: (left: unknown, right: unknown) => ({ operator: "lte", left, right }),
  sql: Object.assign(() => ({ sql: true }), { raw: () => ({ sql: true }) }),
}));

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://test.invalid/sk145";
  resetObservations();
});

async function buildCaller() {
  const { bookingRouter } = await import("../booking");
  return bookingRouter.createCaller({ userId: "user_sk145_booking_filter" });
}

describe("booking.list project filter runtime", () => {
  it("intersects producer, project, and status while preserving ordering and mapping", async () => {
    const caller = await buildCaller();

    const result = await caller.list({ projectId: PROJECT_ID, status: "confirmed" });

    expect(createDb).toHaveBeenCalledOnce();
    expect(bookingWherePredicates).toHaveLength(1);
    const predicate = bookingWherePredicates[0];
    expect(findEqValue(predicate, bookings.producerId)).toBe(PRODUCER_ID);
    expect(findEqValue(predicate, bookings.projectId)).toBe(PROJECT_ID);
    expect(findEqValue(predicate, bookings.status)).toBe("confirmed");
    expect(bookingOrderColumns).toEqual([{ direction: "asc", column: bookings.startsAt }]);
    expect(result).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000151",
        producerId: PRODUCER_ID,
        projectId: PROJECT_ID,
        purchaseId: "00000000-0000-4000-8000-000000000161",
        status: "confirmed",
        startsAt: new Date("2026-08-02T08:00:00.000Z"),
        durationMin: 90,
        artistName: "Early Artist",
        packageNameSnapshot: "Vocal production",
        unitPriceCents: 15_000,
        songQty: 3,
        changeRequest: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000153",
        producerId: PRODUCER_ID,
        projectId: PROJECT_ID,
        purchaseId: "00000000-0000-4000-8000-000000000163",
        status: "confirmed",
        startsAt: new Date("2026-08-04T08:00:00.000Z"),
        durationMin: 120,
        artistName: "Late Artist",
        packageNameSnapshot: "Session",
        unitPriceCents: null,
        songQty: null,
        changeRequest: null,
      },
    ]);
  });

  it("keeps status optional while still returning only the requested owned project", async () => {
    const caller = await buildCaller();

    const result = await caller.list({ projectId: PROJECT_ID });

    const predicate = bookingWherePredicates[0];
    expect(findEqValue(predicate, bookings.producerId)).toBe(PRODUCER_ID);
    expect(findEqValue(predicate, bookings.projectId)).toBe(PROJECT_ID);
    expect(findEqValue(predicate, bookings.status)).toBeUndefined();
    expect(result.map((booking) => booking.id)).toEqual([
      "00000000-0000-4000-8000-000000000151",
      "00000000-0000-4000-8000-000000000152",
      "00000000-0000-4000-8000-000000000153",
    ]);
    expect(result.every((booking) => booking.producerId === PRODUCER_ID)).toBe(true);
    expect(result.every((booking) => booking.projectId === PROJECT_ID)).toBe(true);
  });

  it("returns no producer data for a foreign project id", async () => {
    const caller = await buildCaller();

    const result = await caller.list({ projectId: FOREIGN_PROJECT_ID });

    const predicate = bookingWherePredicates[0];
    expect(findEqValue(predicate, bookings.producerId)).toBe(PRODUCER_ID);
    expect(findEqValue(predicate, bookings.projectId)).toBe(FOREIGN_PROJECT_ID);
    expect(result).toEqual([]);
    expect(result).not.toContainEqual(expect.objectContaining({ artistName: "Foreign Artist" }));
    expect(result).not.toContainEqual(expect.objectContaining({ projectId: OTHER_PROJECT_ID }));
  });
});
