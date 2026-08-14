import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

// Role writes are deliberately absent from this webhook. These spies are
// tripwires: any future INSERT, UPDATE, or role lookup is a regression.
const insertMock = vi.fn();
const updateMock = vi.fn();
const selectMock = vi.fn();

const dbMock = {
  insert: insertMock,
  update: updateMock,
  select: selectMock,
  transaction: (work: (transaction: unknown) => Promise<void>) => transactionMock(work),
};

// Toggle to simulate svix signature failure in a single test.
let verifyShouldThrow = false;

const transactionMock = vi.fn(async (work: (transaction: unknown) => Promise<void>) =>
  work(dbMock),
);
const synchronizeRegisteredAccountMock = vi.fn();

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
}));
vi.mock("~/server/identity/registered-account-sync", () => ({
  RegisteredAccountSyncError: class RegisteredAccountSyncError extends Error {},
  createRegisteredAccountSyncRepository: (database: unknown) => ({ database }),
  synchronizeRegisteredAccount: synchronizeRegisteredAccountMock,
}));
vi.mock("svix", () => ({
  Webhook: class {
    verify(payload: string): unknown {
      if (verifyShouldThrow) throw new Error("bad sig");
      return JSON.parse(payload) as unknown;
    }
  },
}));

const buildReq = (body: string) =>
  new Request("http://x/api/webhooks/clerk", {
    method: "POST",
    headers: { "svix-id": "1", "svix-timestamp": "1", "svix-signature": "x" },
    body,
  });

beforeEach(() => {
  insertMock.mockClear();
  updateMock.mockClear();
  selectMock.mockClear();
  verifyShouldThrow = false;
  transactionMock.mockClear();
  synchronizeRegisteredAccountMock.mockReset();
  synchronizeRegisteredAccountMock.mockImplementation(
    async (
      _repository: unknown,
      event: {
        data?: {
          email_addresses?: { email_address?: string }[];
          first_name?: string | null;
          id?: string;
        };
        type?: string;
      },
      eventId: string,
      _digest: string,
      instanceId: string,
    ) => {
      const id = event.data?.id ?? "";
      if (event.type === "user.deleted") {
        return {
          lifecycle: {
            eventType: "user.deleted",
            instanceId,
            kind: "tombstone",
            tombstone: {
              clerkUserId: id,
              eventId,
              providerUpdatedAt: new Date(1),
            },
          },
          replayed: false,
          terminalDeleted: false,
        };
      }
      const email = event.data?.email_addresses?.[0]?.email_address?.trim().toLowerCase();
      if (event.type === "user.created" && !email) {
        const ErrorType = (await import("~/server/identity/registered-account-sync"))
          .RegisteredAccountSyncError;
        throw new ErrorType();
      }
      return {
        lifecycle: {
          eventType: event.type,
          instanceId,
          kind: "snapshot",
          snapshot: {
            clerkUserId: id,
            displayName: event.data?.first_name?.trim() || null,
            emailVerified: true,
            eventId,
            primaryEmail: email ?? null,
          },
        },
        replayed: false,
        terminalDeleted: false,
      };
    },
  );
  process.env.CLERK_WEBHOOK_SECRET = "test";
  process.env.CLERK_INSTANCE_ID = "ins_test";
  process.env.DATABASE_URL = "x";
});

describe("clerk webhook", () => {
  it("never grants a role for an ordinary user.created event", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: { id: "user_1", email_addresses: [{ email_address: "ada@x.com" }], first_name: "Ada" },
    });
    const res = await POST(buildReq(body));
    expect(res.status).toBe(200);
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns 500 when CLERK_WEBHOOK_SECRET is missing", async () => {
    delete process.env.CLERK_WEBHOOK_SECRET;
    const { POST } = await import("./route");
    const res = await POST(buildReq("{}"));
    expect(res.status).toBe(500);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("fails closed when the environment-bound Clerk instance is missing", async () => {
    delete process.env.CLERK_INSTANCE_ID;
    const { POST } = await import("./route");
    const res = await POST(buildReq("{}"));
    expect(res.status).toBe(500);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid svix signature", async () => {
    verifyShouldThrow = true;
    const { POST } = await import("./route");
    const res = await POST(buildReq("{}"));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns 400 when user.created has no email_addresses", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: { id: "user_2", email_addresses: [] },
    });
    const res = await POST(buildReq(body));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns 200 and skips insert for non user.created events", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({ type: "user.updated", data: { id: "user_3" } });
    const res = await POST(buildReq(body));
    expect(res.status).toBe(200);
    expect(insertMock).not.toHaveBeenCalled();
    expect(transactionMock).toHaveBeenCalledOnce();
  });

  it("binds the signed payload digest and instance inside one transaction", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.updated",
      data: { id: "user_3" },
    });

    const res = await POST(buildReq(body));

    expect(res.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(synchronizeRegisteredAccountMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ type: "user.updated" }),
      "1",
      `sha256:${createHash("sha256").update(body).digest("hex")}`,
      "ins_test",
      expect.any(Function),
    );
  });

  it("stops every signup side effect for an exact signed replay", async () => {
    synchronizeRegisteredAccountMock.mockResolvedValueOnce({
      lifecycle: {
        eventType: "user.created",
        instanceId: "ins_test",
        kind: "snapshot",
        snapshot: {
          clerkUserId: "user_replayed",
          displayName: "Replay",
          emailVerified: true,
          eventId: "1",
          primaryEmail: "replay@example.com",
        },
      },
      replayed: true,
      terminalDeleted: false,
    });
    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: {
        id: "user_replayed",
        email_addresses: [{ email_address: "replay@example.com" }],
      },
    });

    const res = await POST(buildReq(body));

    expect(res.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledOnce();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it.each([false, null])(
    "never provisions or connects a join-origin account when primary-email verification is %s",
    async (emailVerified) => {
      synchronizeRegisteredAccountMock.mockResolvedValueOnce({
        lifecycle: {
          eventType: "user.created",
          instanceId: "ins_test",
          kind: "snapshot",
          snapshot: {
            clerkUserId: "user_unverified",
            displayName: "Unverified",
            emailVerified,
            eventId: "1",
            primaryEmail: "unverified@example.com",
          },
        },
        replayed: false,
        terminalDeleted: false,
      });
      const { POST } = await import("./route");
      const body = JSON.stringify({
        type: "user.created",
        data: {
          id: "user_unverified",
          email_addresses: [{ email_address: "unverified@example.com" }],
          unsafe_metadata: {
            producerSlug: "gili-asraf",
            signupOrigin: "join",
          },
        },
      });

      const res = await POST(buildReq(body));

      expect(res.status).toBe(200);
      expect(selectMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
      expect(insertMock).not.toHaveBeenCalled();
    },
  );

  it("does not run signup side effects for a delayed create after deletion", async () => {
    synchronizeRegisteredAccountMock.mockResolvedValueOnce({
      lifecycle: {
        eventType: "user.created",
        instanceId: "ins_test",
        kind: "snapshot",
        snapshot: {
          clerkUserId: "user_deleted_first",
          displayName: "Deleted",
          emailVerified: true,
          eventId: "1",
          primaryEmail: "deleted@example.com",
        },
      },
      replayed: false,
      terminalDeleted: true,
    });
    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: {
        id: "user_deleted_first",
        email_addresses: [{ email_address: "deleted@example.com" }],
      },
    });

    const res = await POST(buildReq(body));

    expect(res.status).toBe(200);
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
  });
});

describe("user.created — role grants", () => {
  it("does not grant Artist access from client-writeable join metadata", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: {
        id: "user_artist_1",
        email_addresses: [{ email_address: "newfan@example.com" }],
        first_name: "Fan",
        unsafe_metadata: {
          signupOrigin: "join",
          producerSlug: "gili-asraf",
        },
      },
    });

    const res = await POST(buildReq(body));

    expect(res.status).toBe(200);
    expect(selectMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("does not grant either role when unsafe metadata claims Producer access", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({
      type: "user.created",
      data: {
        id: "user_spoofed_producer",
        email_addresses: [{ email_address: "spoofed@example.com" }],
        unsafe_metadata: {
          role: "producer",
          intent: "create-studio",
        },
      },
    });

    const res = await POST(buildReq(body));

    expect(res.status).toBe(200);
    expect(selectMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
