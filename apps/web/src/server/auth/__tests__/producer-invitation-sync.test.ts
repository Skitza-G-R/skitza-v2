import { beforeEach, describe, expect, it, vi } from "vitest";

import { emailHashFor } from "~/server/artist/identity";

import { syncAcceptedProducerInvitation } from "../producer-invitation-sync";

const mocks = vi.hoisted(() => ({
  claimProducerInvitationGrant: vi.fn(),
  clerkClient: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ clerkClient: mocks.clerkClient }));
vi.mock("../producer-invitation-grant", () => ({
  claimProducerInvitationGrant: mocks.claimProducerInvitationGrant,
}));

const CUTOFF = "2026-08-12T00:00:00.000Z";
const CUTOFF_MS = Date.parse(CUTOFF);
const environment: NodeJS.ProcessEnv = {
  CLERK_INSTANCE_ID: "ins_skitza",
  NODE_ENV: "test",
  PRODUCER_INVITATION_CUTOFF: CUTOFF,
};

const getInstance = vi.fn();
const getUser = vi.fn();
const getInvitationList = vi.fn();

function acceptedInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv_producer",
    emailAddress: "artist@example.test",
    status: "accepted",
    revoked: false,
    createdAt: CUTOFF_MS + 1_000,
    updatedAt: CUTOFF_MS + 2_000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.clerkClient.mockResolvedValue({
    instance: { get: getInstance },
    users: { getUser },
    invitations: { getInvitationList },
  });
  getInstance.mockResolvedValue({ id: "ins_skitza" });
  mocks.claimProducerInvitationGrant.mockResolvedValue({ status: "created" });
});

describe("syncAcceptedProducerInvitation", () => {
  it("does nothing before authentication, without touching configuration or Clerk", async () => {
    await expect(
      syncAcceptedProducerInvitation({
        dbUrl: "postgres://test",
        userId: null,
        providerUserId: null,
        environment: { NODE_ENV: "test" },
      }),
    ).resolves.toEqual({ status: "not_authenticated" });
    expect(mocks.clerkClient).not.toHaveBeenCalled();
    expect(mocks.claimProducerInvitationGrant).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, "missing PRODUCER_INVITATION_CUTOFF"],
    ["not-a-date", "invalid PRODUCER_INVITATION_CUTOFF"],
    ["2026-08-12T00:00:00Z", "invalid PRODUCER_INVITATION_CUTOFF"],
    ["2026-08-12", "invalid PRODUCER_INVITATION_CUTOFF"],
  ])("rejects a missing or non-canonical cutoff (%s)", async (cutoff, message) => {
    await expect(
      syncAcceptedProducerInvitation({
        dbUrl: "postgres://test",
        userId: "user_historical",
        providerUserId: "user_artist",
        environment: {
          CLERK_INSTANCE_ID: "ins_skitza",
          NODE_ENV: "test",
          PRODUCER_INVITATION_CUTOFF: cutoff,
        },
      }),
    ).rejects.toThrow(message);
    expect(mocks.clerkClient).not.toHaveBeenCalled();
    expect(mocks.claimProducerInvitationGrant).not.toHaveBeenCalled();
  });

  it("queries only unique normalized verified emails and binds the grant to the configured instance", async () => {
    getUser.mockResolvedValue({
      id: "user_artist",
      emailAddresses: [
        {
          emailAddress: " Artist@Example.Test ",
          verification: { status: "verified" },
        },
        {
          emailAddress: "artist@example.test",
          verification: { status: "verified" },
        },
        {
          emailAddress: "Bookings@Example.Test",
          verification: { status: "verified" },
        },
        {
          emailAddress: "unverified@example.test",
          verification: { status: "unverified" },
        },
        { emailAddress: " ", verification: { status: "verified" } },
      ],
    });
    getInvitationList.mockImplementation(({ query }: { query: string }) =>
      Promise.resolve({
        data: query === "artist@example.test" ? [acceptedInvitation()] : [],
      }),
    );

    await expect(
      syncAcceptedProducerInvitation({
        dbUrl: "postgres://test",
        userId: "user_historical",
        providerUserId: "user_artist",
        environment,
      }),
    ).resolves.toEqual({ status: "created" });

    expect(getInstance).toHaveBeenCalledOnce();
    expect(getInstance.mock.invocationCallOrder[0]).toBeLessThan(
      getUser.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(getInvitationList).toHaveBeenCalledTimes(2);
    expect(getInvitationList).toHaveBeenNthCalledWith(1, {
      limit: 100,
      offset: 0,
      orderBy: "-created_at",
      query: "artist@example.test",
      status: "accepted",
    });
    expect(getInvitationList).toHaveBeenNthCalledWith(2, {
      limit: 100,
      offset: 0,
      orderBy: "-created_at",
      query: "bookings@example.test",
      status: "accepted",
    });
    expect(mocks.claimProducerInvitationGrant).toHaveBeenCalledWith("postgres://test", {
      clerkInstanceId: "ins_skitza",
      clerkUserId: "user_historical",
      providerClerkUserId: "user_artist",
      invitationId: "inv_producer",
      emailAddress: "artist@example.test",
      emailHash: emailHashFor("artist@example.test"),
      createdAt: CUTOFF_MS + 1_000,
      updatedAt: CUTOFF_MS + 2_000,
    });
  });

  it("fails closed when the Clerk secret belongs to another instance", async () => {
    getInstance.mockResolvedValue({ id: "ins_other" });

    await expect(
      syncAcceptedProducerInvitation({
        dbUrl: "postgres://test",
        userId: "user_artist",
        providerUserId: "user_artist",
        environment,
      }),
    ).rejects.toThrow("CLERK_INSTANCE_MISMATCH");
    expect(getUser).not.toHaveBeenCalled();
    expect(getInvitationList).not.toHaveBeenCalled();
    expect(mocks.claimProducerInvitationGrant).not.toHaveBeenCalled();
  });

  it("fails closed when Clerk cannot prove the application instance", async () => {
    getInstance.mockRejectedValue(new Error("Clerk instance lookup failed"));

    await expect(
      syncAcceptedProducerInvitation({
        dbUrl: "postgres://test",
        userId: "user_artist",
        providerUserId: "user_artist",
        environment,
      }),
    ).rejects.toThrow("Clerk instance lookup failed");
    expect(getUser).not.toHaveBeenCalled();
    expect(mocks.claimProducerInvitationGrant).not.toHaveBeenCalled();
  });

  it("does not query invitations when the same Clerk user has no verified email", async () => {
    getUser.mockResolvedValue({
      id: "user_artist",
      emailAddresses: [
        {
          emailAddress: "artist@example.test",
          verification: { status: "unverified" },
        },
      ],
    });

    await expect(
      syncAcceptedProducerInvitation({
        dbUrl: "postgres://test",
        userId: "user_artist",
        providerUserId: "user_artist",
        environment,
      }),
    ).resolves.toEqual({ status: "not_invited" });
    expect(getInvitationList).not.toHaveBeenCalled();
    expect(mocks.claimProducerInvitationGrant).not.toHaveBeenCalled();
  });

  it("does not grant when Clerk's email query returns only a fuzzy match", async () => {
    getUser.mockResolvedValue({
      id: "user_artist",
      emailAddresses: [
        {
          emailAddress: "artist@example.test",
          verification: { status: "verified" },
        },
      ],
    });
    getInvitationList.mockResolvedValue({
      data: [acceptedInvitation({ emailAddress: "xartist@example.test" })],
    });

    await expect(
      syncAcceptedProducerInvitation({
        dbUrl: "postgres://test",
        userId: "user_artist",
        providerUserId: "user_artist",
        environment,
      }),
    ).resolves.toEqual({ status: "not_invited" });
    expect(mocks.claimProducerInvitationGrant).not.toHaveBeenCalled();
  });

  it("grants from an accepted Clerk Dashboard invitation without custom metadata", async () => {
    getUser.mockResolvedValue({
      id: "user_artist",
      emailAddresses: [
        {
          emailAddress: "artist@example.test",
          verification: { status: "verified" },
        },
      ],
    });
    getInvitationList.mockResolvedValue({
      data: [acceptedInvitation()],
    });

    await expect(
      syncAcceptedProducerInvitation({
        dbUrl: "postgres://test",
        userId: "user_artist",
        providerUserId: "user_artist",
        environment,
      }),
    ).resolves.toEqual({ status: "created" });
    expect(mocks.claimProducerInvitationGrant).toHaveBeenCalledOnce();
  });

  it("fails closed when Clerk cannot load the signed-in user", async () => {
    getUser.mockRejectedValue(new Error("Clerk user lookup failed"));

    await expect(
      syncAcceptedProducerInvitation({
        dbUrl: "postgres://test",
        userId: "user_artist",
        providerUserId: "user_artist",
        environment,
      }),
    ).rejects.toThrow("Clerk user lookup failed");
    expect(getInvitationList).not.toHaveBeenCalled();
    expect(mocks.claimProducerInvitationGrant).not.toHaveBeenCalled();
  });

  it("fails closed when Clerk cannot list accepted invitations", async () => {
    getUser.mockResolvedValue({
      id: "user_artist",
      emailAddresses: [
        {
          emailAddress: "artist@example.test",
          verification: { status: "verified" },
        },
      ],
    });
    getInvitationList.mockRejectedValue(new Error("Clerk invitation lookup failed"));

    await expect(
      syncAcceptedProducerInvitation({
        dbUrl: "postgres://test",
        userId: "user_artist",
        providerUserId: "user_artist",
        environment,
      }),
    ).rejects.toThrow("Clerk invitation lookup failed");
    expect(mocks.claimProducerInvitationGrant).not.toHaveBeenCalled();
  });
});
