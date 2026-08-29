import { beforeEach, describe, expect, it, vi } from "vitest";

// SK-287 regression, reproducing the live 2026-08-29 failure end to end:
// a confirmed session ~50 minutes out, a provider that REFUSES the send, and
// a sweep that stamped `reminder_sent_1h` and reported `sent.one = 1` anyway.
// The real `sendSessionReminder1h` runs here — only the provider is faked —
// so this fails unless the sender actually surfaces the refusal.
const { bookingsMarker, clientContactsMarker, mocks, producersMarker, purchasesMarker } =
  vi.hoisted(() => ({
    mocks: { send: vi.fn(), emitArtistSessionNotification: vi.fn() },
    bookingsMarker: { table: "bookings" } as never,
    producersMarker: { table: "producers" } as never,
    purchasesMarker: { table: "purchases" } as never,
    clientContactsMarker: { table: "client_contacts" } as never,
  }));

vi.mock("@skitza/db", () => ({
  and: (...conditions: unknown[]) => ({ conditions }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  gte: (column: unknown, value: unknown) => ({ column, value }),
  lte: (column: unknown, value: unknown) => ({ column, value }),
  isNull: (column: unknown) => ({ column }),
  createDb: () => ({}),
  bookings: bookingsMarker,
  producers: producersMarker,
  purchases: purchasesMarker,
  clientContacts: clientContactsMarker,
}));

vi.mock("~/server/email/client", () => ({
  getResend: () => ({ emails: { send: mocks.send } }),
  FROM_ADDRESS: "Skitza <hello@send.skitza.test>",
  SITE_URL: "https://skitza.test",
}));

vi.mock("~/server/artist/notification-emitters", () => ({
  emitArtistSessionNotification: mocks.emitArtistSessionNotification,
}));

vi.mock("~/server/domain/session-booking/db", () => ({ sessionBookingRepository: vi.fn() }));
vi.mock("~/server/domain/session-booking/service", () => ({ expireHeldSessionBooking: vi.fn() }));

import { runSessionReminderSweep } from "./session-reminder-sweep";

type Row = Record<string, unknown>;

const NOW = new Date("2026-08-29T07:13:41Z");
const DUE_BOOKING = {
  id: "b-1",
  producerId: "p-1",
  purchaseId: "pu-1",
  artistName: "Ada",
  artistEmail: "ada@example.test",
  startsAt: new Date(NOW.getTime() + 50 * 60 * 1000),
  durationMin: 60,
};

// Minimal Drizzle stand-in. The three booking scans share one call shape, so
// they are served in the order the sweep issues them: held, 24h, then 1h.
function fakeDb(bookingScans: Row[][]) {
  const setCalls: Row[] = [];
  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === bookingsMarker) {
          const rows = bookingScans.shift() ?? [];
          return { where: () => Promise.resolve(rows) };
        }
        if (table === producersMarker) {
          return {
            where: () => ({
              limit: () =>
                Promise.resolve([
                  { email: "gili@example.test", displayName: "Gili", timezone: "UTC" },
                ]),
            }),
          };
        }
        return {
          innerJoin: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  {
                    snapshot: { productOrOfferName: "Mixing session" },
                    artistClerkUserId: null,
                    artistContactArchivedAt: null,
                  },
                ]),
            }),
          }),
        };
      },
    }),
    update: () => ({
      set: (values: Row) => {
        setCalls.push(values);
        return {
          where: () =>
            // The claim awaits `.returning(...)`; the unclaim awaits the
            // `.where(...)` call itself.
            Object.assign(Promise.resolve(undefined), {
              returning: () => Promise.resolve([{ id: DUE_BOOKING.id }]),
            }),
        };
      },
    }),
  };
  return { db: db as never, setCalls };
}

describe("runSessionReminderSweep — 1h reminder the provider refuses", () => {
  beforeEach(() => {
    mocks.send.mockReset();
    mocks.emitArtistSessionNotification.mockReset().mockResolvedValue({ emailEnabled: true });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("releases the claim and does not report the reminder as sent", async () => {
    mocks.send.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "API key is invalid", statusCode: 401 },
      headers: null,
    });
    const { db, setCalls } = fakeDb([[], [], [DUE_BOOKING]]);

    const result = await runSessionReminderSweep(db, NOW);

    // The row was claimed, then released so the next sweep retries it.
    expect(setCalls).toContainEqual({ reminderSent1h: NOW });
    expect(setCalls).toContainEqual({ reminderSent1h: null });
    expect(result.sent.one).toBe(0);
  });

  it("keeps the claim and reports the reminder as sent when the provider accepts", async () => {
    mocks.send.mockResolvedValue({ data: { id: "re_123" }, error: null, headers: null });
    const { db, setCalls } = fakeDb([[], [], [DUE_BOOKING]]);

    const result = await runSessionReminderSweep(db, NOW);

    expect(setCalls).toContainEqual({ reminderSent1h: NOW });
    expect(setCalls).not.toContainEqual({ reminderSent1h: null });
    expect(result.sent.one).toBe(1);
  });
});
