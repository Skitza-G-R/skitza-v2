import { beforeEach, describe, expect, it, vi } from "vitest";

type ContactFixture = {
  clerkUserId: string;
  producerId: string;
  email: string;
  archivedAt: Date | null;
};

type Row = Record<string, unknown>;

const {
  bookingsMarker,
  clientContactsMarker,
  producersMarker,
  productsMarker,
  fixtures,
  clientContactJoinSpy,
  productSelectSpy,
  productWhereSpy,
  dbMock,
} = vi.hoisted(() => {
  const clientContactsMarker = {
    __table: "client_contacts",
    clerkUserId: { __column: "client_contacts.clerk_user_id" },
    producerId: { __column: "client_contacts.producer_id" },
    email: { __column: "client_contacts.email" },
    archivedAt: { __column: "client_contacts.archived_at" },
  };
  const bookingsMarker = {
    __table: "bookings",
    id: { __column: "bookings.id" },
    producerId: { __column: "bookings.producer_id" },
    artistEmail: { __column: "bookings.artist_email" },
    artistName: { __column: "bookings.artist_name" },
    status: { __column: "bookings.status" },
    startsAt: { __column: "bookings.starts_at" },
    durationMin: { __column: "bookings.duration_min" },
    productId: { __column: "bookings.product_id" },
    packageNameSnapshot: { __column: "bookings.package_name_snapshot" },
  };
  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    displayName: { __column: "producers.display_name" },
    tranzilaTerminalName: { __column: "producers.tranzila_terminal_name" },
  };
  const productsMarker = {
    __table: "products",
    id: { __column: "products.id" },
    producerId: { __column: "products.producer_id" },
    name: { __column: "products.name" },
    priceCents: { __column: "products.price_cents" },
    currency: { __column: "products.currency" },
    paymentPlans: { __column: "products.payment_plans" },
  };

  const fixtures: {
    contacts: ContactFixture[];
    booking: Row | null;
    product: Row | null;
  } = {
    contacts: [],
    booking: null,
    product: null,
  };
  const clientContactJoinSpy = vi.fn<(on: unknown) => void>();
  const productSelectSpy = vi.fn<() => void>();
  const productWhereSpy = vi.fn<(predicate: unknown) => void>();

  const chain = (table: unknown) => {
    let joinedClientContacts = false;
    let resolved: Promise<Row[]> | null = null;

    const resolveRows = (): Row[] => {
      if (table === clientContactsMarker) return fixtures.contacts;

      if (table === bookingsMarker) {
        const booking = fixtures.booking;
        if (!booking) return [];
        if (!joinedClientContacts) return [booking];

        const hasExactActivePair = fixtures.contacts.some(
          (contact) =>
            contact.clerkUserId === "user_artist" &&
            contact.producerId === booking.producerId &&
            contact.email.toLowerCase() ===
              String(booking.artistEmail).toLowerCase() &&
            contact.archivedAt === null,
        );
        return hasExactActivePair ? [booking] : [];
      }

      if (table === productsMarker) {
        productSelectSpy();
        return fixtures.product ? [fixtures.product] : [];
      }

      throw new Error(`unexpected from(${String(table)})`);
    };

    const get = () => {
      resolved ??= Promise.resolve(resolveRows());
      return resolved;
    };

    type Link = {
      where: (predicate: unknown) => Link;
      innerJoin: (joinedTable: unknown, on: unknown) => Link;
      limit: (count: number) => Promise<Row[]>;
      then: Promise<Row[]>["then"];
    };

    const link: Link = {
      where: (predicate: unknown) => {
        if (table === productsMarker) productWhereSpy(predicate);
        return link;
      },
      innerJoin: (joinedTable: unknown, on: unknown) => {
        if (joinedTable === clientContactsMarker) {
          joinedClientContacts = true;
          clientContactJoinSpy(on);
        }
        return link;
      },
      limit: () => get(),
      get then() {
        const promise = get();
        return promise.then.bind(promise);
      },
    };

    return link;
  };

  const dbMock = {
    select: () => ({ from: (table: unknown) => chain(table) }),
  };

  return {
    bookingsMarker,
    clientContactsMarker,
    producersMarker,
    productsMarker,
    fixtures,
    clientContactJoinSpy,
    productSelectSpy,
    productWhereSpy,
    dbMock,
  };
});

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  bookings: bookingsMarker,
  clientContacts: clientContactsMarker,
  producers: producersMarker,
  products: productsMarker,
  projects: {
    id: { __column: "projects.id" },
    producerId: { __column: "projects.producer_id" },
    artistEmail: { __column: "projects.artist_email" },
  },
  eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
  and: (...conditions: unknown[]) => ({ and: conditions }),
  isNull: (column: unknown) => ({ isNull: column }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    sqlText: strings.join("?"),
    sqlValues: values,
  }),
}));

const USER_ID = "user_artist";
const PRODUCER_A_ID = "00000000-0000-4000-8000-00000000000a";
const PRODUCER_B_ID = "00000000-0000-4000-8000-00000000000b";
const BOOKING_ID = "00000000-0000-4000-8000-000000000100";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000200";
const SHARED_EMAIL = "shared@example.com";

const bookingFixture = {
  bookingId: BOOKING_ID,
  producerId: PRODUCER_B_ID,
  status: "pending_payment",
  artistEmail: SHARED_EMAIL,
  artistName: "Shared Name",
  startsAt: new Date("2026-08-01T09:00:00.000Z"),
  durationMin: 120,
  productId: PRODUCT_ID,
  packageNameSnapshot: "Mix session",
  producerName: "Studio B",
  producerTranzilaTerminalName: null,
};

const productFixture = {
  id: PRODUCT_ID,
  producerId: PRODUCER_B_ID,
  name: "Mix session",
  priceCents: 50_000,
  currency: "ILS",
  paymentPlans: [{ kind: "full" }],
};

const expectExactPairJoin = () => {
  expect(clientContactJoinSpy).toHaveBeenCalledTimes(1);
  const predicate = clientContactJoinSpy.mock.calls[0]?.[0];
  expect(predicate).toEqual({
    and: [
      { eq: [clientContactsMarker.clerkUserId, USER_ID] },
      {
        eq: [clientContactsMarker.producerId, bookingsMarker.producerId],
      },
      {
        eq: [
          {
            sqlText: "lower(?)",
            sqlValues: [clientContactsMarker.email],
          },
          {
            sqlText: "lower(?)",
            sqlValues: [bookingsMarker.artistEmail],
          },
        ],
      },
      { isNull: clientContactsMarker.archivedAt },
    ],
  });
};

const buildCaller = async () => {
  const { paymentRouter } = await import("../payment");
  return paymentRouter.createCaller({ userId: USER_ID });
};

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://test/test";
  fixtures.contacts = [];
  fixtures.booking = bookingFixture;
  fixtures.product = productFixture;
  clientContactJoinSpy.mockReset();
  productSelectSpy.mockReset();
  productWhereSpy.mockReset();
});

describe("payment.getPaymentDetails relationship authorization", () => {
  it("denies a same-email booking from a different producer relationship", async () => {
    fixtures.contacts = [
      {
        clerkUserId: USER_ID,
        producerId: PRODUCER_A_ID,
        email: SHARED_EMAIL,
        archivedAt: null,
      },
    ];

    const caller = await buildCaller();

    await expect(
      caller.getPaymentDetails({ bookingId: BOOKING_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(productSelectSpy).not.toHaveBeenCalled();
    expectExactPairJoin();
  });

  it("allows access for the exact active producer-client pair", async () => {
    fixtures.contacts = [
      {
        clerkUserId: USER_ID,
        producerId: PRODUCER_B_ID,
        email: SHARED_EMAIL.toUpperCase(),
        archivedAt: null,
      },
    ];

    const caller = await buildCaller();
    const result = await caller.getPaymentDetails({ bookingId: BOOKING_ID });

    expect(result.booking.id).toBe(BOOKING_ID);
    expect(result.product.id).toBe(PRODUCT_ID);
    expectExactPairJoin();
    expect(productWhereSpy).toHaveBeenCalledWith({
      and: [
        { eq: [productsMarker.id, PRODUCT_ID] },
        { eq: [productsMarker.producerId, PRODUCER_B_ID] },
      ],
    });
  });

  it("denies an archived exact producer-client pair", async () => {
    fixtures.contacts = [
      {
        clerkUserId: USER_ID,
        producerId: PRODUCER_B_ID,
        email: SHARED_EMAIL,
        archivedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ];

    const caller = await buildCaller();

    await expect(
      caller.getPaymentDetails({ bookingId: BOOKING_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(productSelectSpy).not.toHaveBeenCalled();
    expectExactPairJoin();
  });
});
