import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for clientContacts.create — Clients & Projects v3 redesign
// Phase 1 (G6). The mutation backs the New Client modal: it accepts
// { email, name, phone?, notes? }, hashes the email for dedupe, and
// either returns an existing row (existed: true) untouched OR inserts
// a fresh contact with the modal's optional fields persisted.
//
// Pattern follows client-contacts-send-invite.test.ts — vi.hoisted
// to lift the dbMock / spies into vi.mock factories at module-eval.

const PRODUCER_ID = "producer-uuid-create-1";
const CONTACT_ID = "00000000-0000-0000-0000-0000000000aa";

const {
  producersMarker,
  clientContactsMarker,
  existingSelectMock,
  insertValuesSpy,
  insertReturningMock,
  dbMock,
} = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const existingSelectMock = vi.fn<() => Promise<Row[]>>();
  const insertValuesSpy = vi.fn<(payload: Row) => void>();
  const insertReturningMock = vi.fn<() => Promise<Row[]>>();

  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    clerkUserId: { __column: "producers.clerk_user_id" },
  };
  const clientContactsMarker = {
    __table: "client_contacts",
    id: { __column: "client_contacts.id" },
    producerId: { __column: "client_contacts.producer_id" },
    emailHash: { __column: "client_contacts.email_hash" },
    email: { __column: "client_contacts.email" },
    name: { __column: "client_contacts.name" },
    phone: { __column: "client_contacts.phone" },
    notes: { __column: "client_contacts.notes" },
  };

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === producersMarker) {
          return {
            where: () => ({
              limit: () => Promise.resolve([{ id: PRODUCER_ID }]),
            }),
          };
        }
        if (table === clientContactsMarker) {
          return {
            where: () => ({
              limit: () => existingSelectMock(),
            }),
          };
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
    insert: () => ({
      values: (payload: Row) => {
        insertValuesSpy(payload);
        return { returning: () => insertReturningMock() };
      },
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve() }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  };

  return {
    producersMarker,
    clientContactsMarker,
    existingSelectMock,
    insertValuesSpy,
    insertReturningMock,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_create" }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  clientContacts: clientContactsMarker,
  projects: { __table: "projects" },
  products: { __table: "products" },
  bookings: { __table: "bookings" },
  projectTracks: { __table: "project_tracks" },
  trackComments: { __table: "track_comments" },
  trackVersions: { __table: "track_versions" },
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  and: (...conds: unknown[]) => ({ and: conds }),
  or: (...conds: unknown[]) => ({ or: conds }),
  desc: (col: unknown) => ({ desc: col }),
  asc: (col: unknown) => ({ asc: col }),
  inArray: (col: unknown, vals: unknown[]) => ({ inArray: [col, vals] }),
  sql: () => ({ sql: true }),
}));
vi.mock("~/server/artist/identity", () => ({
  emailHashFor: (email: string) => `hash:${email.trim().toLowerCase()}`,
}));
vi.mock("~/server/email/send", () => ({
  SITE_URL: "https://skitza.app",
  sendClientInviteEmail: () => Promise.resolve(),
}));

beforeEach(() => {
  existingSelectMock.mockReset().mockResolvedValue([]);
  insertValuesSpy.mockReset();
  insertReturningMock.mockReset().mockResolvedValue([]);
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_create" });
};

describe("clientContacts.create", () => {
  it("inserts a new contact with phone + notes when provided", async () => {
    existingSelectMock.mockResolvedValueOnce([]);
    insertReturningMock.mockResolvedValueOnce([
      {
        id: CONTACT_ID,
        email: "rina@example.com",
        name: "Rina",
      },
    ]);

    const caller = await buildCaller();
    const res = await caller.clientContacts.create({
      email: "Rina@Example.com",
      name: "Rina",
      phone: "+972 50 123 4567",
      notes: "Loves analog warmth",
    });

    expect(res.existed).toBe(false);
    expect(res.id).toBe(CONTACT_ID);

    const payload = insertValuesSpy.mock.calls[0]?.[0] ?? {};
    // Email is lowercased before insert.
    expect(payload.email).toBe("rina@example.com");
    expect(payload.name).toBe("Rina");
    expect(payload.phone).toBe("+972 50 123 4567");
    expect(payload.notes).toBe("Loves analog warmth");
  });

  it("inserts NULL for phone + notes when omitted", async () => {
    existingSelectMock.mockResolvedValueOnce([]);
    insertReturningMock.mockResolvedValueOnce([
      {
        id: CONTACT_ID,
        email: "min@example.com",
        name: "Min",
      },
    ]);

    const caller = await buildCaller();
    await caller.clientContacts.create({
      email: "min@example.com",
      name: "Min",
    });

    const payload = insertValuesSpy.mock.calls[0]?.[0] ?? {};
    expect(payload.phone).toBeNull();
    expect(payload.notes).toBeNull();
  });

  it("treats whitespace-only phone/notes as NULL", async () => {
    existingSelectMock.mockResolvedValueOnce([]);
    insertReturningMock.mockResolvedValueOnce([
      {
        id: CONTACT_ID,
        email: "ws@example.com",
        name: "Ws",
      },
    ]);

    const caller = await buildCaller();
    await caller.clientContacts.create({
      email: "ws@example.com",
      name: "Ws",
      phone: "   ",
      notes: "   ",
    });

    const payload = insertValuesSpy.mock.calls[0]?.[0] ?? {};
    expect(payload.phone).toBeNull();
    expect(payload.notes).toBeNull();
  });

  it("returns existed:true and does NOT overwrite phone/notes for a duplicate email", async () => {
    existingSelectMock.mockResolvedValueOnce([
      {
        id: CONTACT_ID,
        email: "dup@example.com",
        name: "Old Name",
        // The pre-existing row already has phone/notes set by the
        // producer through Edit. We must NOT touch them here.
        phone: "+1 555 0100",
        notes: "Existing note",
      },
    ]);

    const caller = await buildCaller();
    const res = await caller.clientContacts.create({
      email: "DUP@example.com",
      name: "New Name",
      phone: "+972 50 999 9999",
      notes: "Trying to overwrite",
    });

    expect(res.existed).toBe(true);
    expect(res.id).toBe(CONTACT_ID);
    expect(res.email).toBe("dup@example.com");
    // Crucially, no insert happened — the existing row is untouched.
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it("rejects an invalid email via zod", async () => {
    const caller = await buildCaller();
    await expect(
      caller.clientContacts.create({
        email: "not-an-email",
        name: "Invalid",
      }),
    ).rejects.toThrow();
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it("rejects a phone longer than 40 chars via zod", async () => {
    const caller = await buildCaller();
    await expect(
      caller.clientContacts.create({
        email: "long@example.com",
        name: "Long",
        phone: "x".repeat(41),
      }),
    ).rejects.toThrow();
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it("rejects notes longer than 2000 chars via zod", async () => {
    const caller = await buildCaller();
    await expect(
      caller.clientContacts.create({
        email: "long@example.com",
        name: "Long",
        notes: "n".repeat(2001),
      }),
    ).rejects.toThrow();
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });
});
