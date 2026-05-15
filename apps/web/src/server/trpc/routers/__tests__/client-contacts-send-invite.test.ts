import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for clientContacts.sendInvite — Clients & Projects v3 redesign
// Phase 1, Task 13. Stamps invited_at = now() on the contact, dispatches
// an invite email if via='email', and returns { invitedAt, via }.
//
// Pattern: lifts the mocked DB + email dispatcher into vi.hoisted so
// vi.mock factories at module-eval time can grab refs. Mirrors
// apps/web/src/server/trpc/routers/__tests__/client-contacts-set-tags.test.ts.

const PRODUCER_ID = "producer-uuid-sendInvite-1";
const OTHER_PRODUCER_ID = "producer-uuid-sendInvite-2";
const CONTACT_ID = "00000000-0000-0000-0000-000000000001";

const {
  producersMarker,
  clientContactsMarker,
  ownerSelectMock,
  setSpy,
  updateMock,
  sendEmailSpy,
  dbMock,
} = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const ownerSelectMock = vi.fn<() => Promise<Row[]>>();
  const setSpy = vi.fn<(payload: Row) => void>();
  const updateMock = vi.fn<() => Promise<void>>();
  const sendEmailSpy = vi.fn<(to: string, props: Row) => Promise<void>>();

  const producersMarker = {
    __table: "producers",
    id: { __column: "producers.id" },
    clerkUserId: { __column: "producers.clerk_user_id" },
    slug: { __column: "producers.slug" },
  };
  const clientContactsMarker = {
    __table: "client_contacts",
    id: { __column: "client_contacts.id" },
    producerId: { __column: "client_contacts.producer_id" },
    email: { __column: "client_contacts.email" },
    name: { __column: "client_contacts.name" },
    invitedAt: { __column: "client_contacts.invited_at" },
  };

  const dbMock = {
    select: () => ({
      from: (table: unknown) => {
        if (table === producersMarker) {
          return {
            where: () => ({
              limit: () =>
                Promise.resolve([{ id: PRODUCER_ID, slug: "test-slug" }]),
            }),
          };
        }
        if (table === clientContactsMarker) {
          return {
            where: () => ({
              limit: () => ownerSelectMock(),
            }),
          };
        }
        throw new Error(`unexpected from(${String(table)})`);
      },
    }),
    update: () => ({
      set: (payload: Row) => {
        setSpy(payload);
        return { where: () => updateMock() };
      },
    }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([]) }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  };

  return {
    producersMarker,
    clientContactsMarker,
    ownerSelectMock,
    setSpy,
    updateMock,
    sendEmailSpy,
    dbMock,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => Promise.resolve({ userId: "user_test_sendinvite" }),
}));
vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  producers: producersMarker,
  clientContacts: clientContactsMarker,
  // Other tables referenced by the client-contacts router file.
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
  emailHashFor: (email: string) => `hash:${email}`,
}));
// Stub the email dispatcher so 'send email' path is observable without
// hitting Resend in tests. Matches the (to, props) signature.
vi.mock("~/server/email/send", () => ({
  SITE_URL: "https://skitza.app",
  sendClientInviteEmail: (to: string, props: Record<string, unknown>) =>
    sendEmailSpy(to, props),
}));

beforeEach(() => {
  ownerSelectMock.mockReset().mockResolvedValue([]);
  setSpy.mockReset();
  updateMock.mockReset().mockResolvedValue(undefined);
  sendEmailSpy.mockReset().mockResolvedValue(undefined);
  process.env.DATABASE_URL = "postgresql://test/test";
});

const buildCaller = async () => {
  const { appRouter } = await import("../_app");
  return appRouter.createCaller({ userId: "user_test_sendinvite" });
};

describe("clientContacts.sendInvite", () => {
  it("stamps invited_at and returns { invitedAt, via } on the link path", async () => {
    ownerSelectMock.mockResolvedValueOnce([
      {
        id: CONTACT_ID,
        producerId: PRODUCER_ID,
        email: "noa@example.com",
        name: "Noa Kirel",
      },
    ]);
    const caller = await buildCaller();
    const before = Date.now();
    const res = await caller.clientContacts.sendInvite({
      id: CONTACT_ID,
      via: "link",
    });
    const after = Date.now();
    expect(res.via).toBe("link");
    expect(res.invitedAt).toBeInstanceOf(Date);
    expect(res.invitedAt.getTime()).toBeGreaterThanOrEqual(before - 1);
    expect(res.invitedAt.getTime()).toBeLessThanOrEqual(after + 1);
    // Wrote invited_at, did NOT send an email.
    expect(updateMock).toHaveBeenCalledTimes(1);
    const payload = setSpy.mock.calls[0]?.[0] ?? {};
    expect(payload.invitedAt).toBeInstanceOf(Date);
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  it("dispatches an invite email on the email path", async () => {
    ownerSelectMock.mockResolvedValueOnce([
      {
        id: CONTACT_ID,
        producerId: PRODUCER_ID,
        email: "noa@example.com",
        name: "Noa Kirel",
      },
    ]);
    const caller = await buildCaller();
    const res = await caller.clientContacts.sendInvite({
      id: CONTACT_ID,
      via: "email",
    });
    expect(res.via).toBe("email");
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    const [to, props] = sendEmailSpy.mock.calls[0] ?? [];
    expect(to).toBe("noa@example.com");
    expect(props?.clientName).toBe("Noa Kirel");
    // The invite URL must include the producer slug + contact id.
    const inviteUrl = props?.inviteUrl;
    expect(typeof inviteUrl).toBe("string");
    expect(inviteUrl as string).toContain("test-slug");
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("throws FORBIDDEN when the contact belongs to another producer", async () => {
    ownerSelectMock.mockResolvedValueOnce([
      {
        id: CONTACT_ID,
        producerId: OTHER_PRODUCER_ID,
        email: "x@example.com",
        name: "X",
      },
    ]);
    const caller = await buildCaller();
    await expect(
      caller.clientContacts.sendInvite({ id: CONTACT_ID, via: "link" }),
    ).rejects.toThrow();
    expect(updateMock).not.toHaveBeenCalled();
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when the contact id doesn't exist", async () => {
    ownerSelectMock.mockResolvedValueOnce([]);
    const caller = await buildCaller();
    await expect(
      caller.clientContacts.sendInvite({ id: CONTACT_ID, via: "link" }),
    ).rejects.toThrow();
    expect(updateMock).not.toHaveBeenCalled();
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  it("succeeds via link even when the contact has no email on file", async () => {
    // Edge case: client_contacts.email is NOT NULL in the schema, but
    // the modal's UI permits firing the link path on an "unknown email"
    // contact regardless. The mutation must not crash on a falsy email
    // when via='link' (it never reads it).
    ownerSelectMock.mockResolvedValueOnce([
      {
        id: CONTACT_ID,
        producerId: PRODUCER_ID,
        email: "",
        name: "Anon",
      },
    ]);
    const caller = await buildCaller();
    const res = await caller.clientContacts.sendInvite({
      id: CONTACT_ID,
      via: "link",
    });
    expect(res.via).toBe("link");
    expect(sendEmailSpy).not.toHaveBeenCalled();
  });

  it("does NOT stamp invited_at when the email send throws", async () => {
    // Email is sent BEFORE invited_at is stamped, so a Resend failure
    // (sandbox / unverified domain / rate-limit) leaves the contact
    // in its prior state — the LinkPill keeps showing "Invite to app"
    // so the producer can retry. This regression guards the email-first
    // ordering in client-contacts.ts:sendInvite.
    ownerSelectMock.mockResolvedValueOnce([
      {
        id: CONTACT_ID,
        producerId: PRODUCER_ID,
        email: "noa@example.com",
        name: "Noa Kirel",
      },
    ]);
    sendEmailSpy.mockRejectedValueOnce(new Error("Resend sandbox reject"));
    const caller = await buildCaller();
    await expect(
      caller.clientContacts.sendInvite({ id: CONTACT_ID, via: "email" }),
    ).rejects.toThrow(/Resend sandbox reject/);
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid via values via zod", async () => {
    ownerSelectMock.mockResolvedValueOnce([
      {
        id: CONTACT_ID,
        producerId: PRODUCER_ID,
        email: "x@example.com",
        name: "X",
      },
    ]);
    const caller = await buildCaller();
    await expect(
      caller.clientContacts.sendInvite({
        id: CONTACT_ID,
        // @ts-expect-error — testing the runtime rejection
        via: "fax",
      }),
    ).rejects.toThrow();
  });
});
