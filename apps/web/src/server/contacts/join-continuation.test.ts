import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  connectVerifiedArtistToProducerMock,
  currentUserMock,
  findConfirmedContactMock,
  verifiedEmailHashesFromUserMock,
} = vi.hoisted(() => ({
  connectVerifiedArtistToProducerMock: vi.fn(),
  currentUserMock: vi.fn(),
  findConfirmedContactMock: vi.fn(),
  verifiedEmailHashesFromUserMock: vi.fn(),
}));

const dbMock = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit: findConfirmedContactMock })),
    })),
  })),
};

vi.mock("@clerk/nextjs/server", () => ({ currentUser: currentUserMock }));
vi.mock("@skitza/db", () => ({
  and: (...values: unknown[]) => values,
  clientContacts: {
    archivedAt: "archivedAt",
    clerkUserId: "clerkUserId",
    id: "id",
    producerId: "producerId",
  },
  createDb: () => dbMock,
  eq: (column: unknown, value: unknown) => ({ column, value }),
  isNull: (column: unknown) => ({ column, isNull: true }),
  producers: {
    clerkUserId: "producerClerkUserId",
    displayName: "displayName",
    id: "producerId",
    slug: "slug",
  },
}));
vi.mock("~/server/auth/verified-email", () => ({
  verifiedEmailHashesFromUser: verifiedEmailHashesFromUserMock,
}));
vi.mock("./connect-artist", () => ({
  connectVerifiedArtistToProducer: connectVerifiedArtistToProducerMock,
}));

import {
  isSelfJoin,
  joinArtistHref,
  joinBookingHref,
  connectCurrentUserForJoin,
  joinEntryMode,
  joinStoreHref,
  JoinContinuationError,
  type JoinTargetProducer,
} from "./join-continuation";

const target: JoinTargetProducer = {
  id: "producer-target",
  clerkUserId: "owner-user",
  displayName: "Northline Studio",
  slug: "northline-studio",
};

beforeEach(() => {
  connectVerifiedArtistToProducerMock.mockReset();
  connectVerifiedArtistToProducerMock.mockResolvedValue(undefined);
  currentUserMock.mockReset();
  findConfirmedContactMock.mockReset();
  findConfirmedContactMock.mockResolvedValue([{ id: "contact-id" }]);
  verifiedEmailHashesFromUserMock.mockReset();
});

function clerkUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "artist-user",
    firstName: "Ada",
    lastName: "Artist",
    primaryEmailAddress: { emailAddress: "  ADA@example.com  " },
    username: "ada",
    ...overrides,
  };
}

async function expectJoinError(operation: Promise<unknown>, code: JoinContinuationError["code"]) {
  await expect(operation).rejects.toMatchObject({
    code,
    name: "JoinContinuationError",
  });
}

describe("join continuation security", () => {
  it("rejects an unauthenticated request before reading Clerk", async () => {
    await expectJoinError(
      connectCurrentUserForJoin({ dbUrl: "postgres://test", userId: null, target }),
      "UNAUTHENTICATED",
    );
    expect(currentUserMock).not.toHaveBeenCalled();
    expect(connectVerifiedArtistToProducerMock).not.toHaveBeenCalled();
  });

  it("blocks a Producer from joining their own public page", () => {
    expect(isSelfJoin("owner-user", target)).toBe(true);
    expect(isSelfJoin("different-user", target)).toBe(false);
  });

  it("rejects self-join before reading Clerk or writing a contact", async () => {
    await expectJoinError(
      connectCurrentUserForJoin({
        dbUrl: "postgres://test",
        userId: "owner-user",
        target,
      }),
      "SELF_JOIN",
    );
    expect(currentUserMock).not.toHaveBeenCalled();
    expect(connectVerifiedArtistToProducerMock).not.toHaveBeenCalled();
  });

  it("rejects a Clerk user that cannot prove a verified email for the exact session user", async () => {
    const user = clerkUser({ id: "different-clerk-user" });
    currentUserMock.mockResolvedValue(user);
    verifiedEmailHashesFromUserMock.mockReturnValue([]);

    await expectJoinError(
      connectCurrentUserForJoin({
        dbUrl: "postgres://test",
        userId: "artist-user",
        target,
      }),
      "UNVERIFIED_EMAIL",
    );

    expect(verifiedEmailHashesFromUserMock).toHaveBeenCalledWith(user, "artist-user");
    expect(connectVerifiedArtistToProducerMock).not.toHaveBeenCalled();
  });

  it("connects only the verified identity to the requested Producer", async () => {
    const user = clerkUser();
    currentUserMock.mockResolvedValue(user);
    verifiedEmailHashesFromUserMock.mockReturnValue(["a".repeat(64)]);

    await expect(
      connectCurrentUserForJoin({
        dbUrl: "postgres://test",
        userId: "artist-user",
        target,
      }),
    ).resolves.toBe("/artist/book?studio=producer-target");

    expect(verifiedEmailHashesFromUserMock).toHaveBeenCalledWith(user, "artist-user");
    expect(connectVerifiedArtistToProducerMock).toHaveBeenCalledWith(dbMock, {
      producerId: "producer-target",
      primaryEmail: "ada@example.com",
      verifiedEmailHashes: ["a".repeat(64)],
      name: "Ada Artist",
      clerkUserId: "artist-user",
    });
    expect(findConfirmedContactMock).toHaveBeenCalledOnce();
  });

  it("fails closed when the exact active contact cannot be confirmed", async () => {
    currentUserMock.mockResolvedValue(clerkUser());
    verifiedEmailHashesFromUserMock.mockReturnValue(["b".repeat(64)]);
    findConfirmedContactMock.mockResolvedValue([]);

    await expectJoinError(
      connectCurrentUserForJoin({
        dbUrl: "postgres://test",
        userId: "artist-user",
        target,
      }),
      "CONNECTION_NOT_CONFIRMED",
    );
    expect(connectVerifiedArtistToProducerMock).toHaveBeenCalledOnce();
  });

  it("continues the requested action directly in the target studio", () => {
    expect(joinBookingHref(target)).toBe("/artist/book?studio=producer-target");
    expect(joinArtistHref(target)).toBe("/artist?studio=producer-target");
    expect(joinStoreHref(target)).toBe("/artist/store?studio=producer-target");
  });

  it("keeps new and returning Artists on the direct booking path", () => {
    expect(
      joinEntryMode({
        isAuthenticated: true,
        producer: { status: "none", profile: null },
        artist: { hasAccess: false, hasActiveConnections: false },
      }),
    ).toBe("direct");
    expect(
      joinEntryMode({
        isAuthenticated: true,
        producer: { status: "none", profile: null },
        artist: { hasAccess: true, hasActiveConnections: true },
      }),
    ).toBe("direct");
  });

  it.each(["complete", "incomplete"] as const)(
    "requires the approved confirmation for a %s Producer",
    (status) => {
      expect(
        joinEntryMode({
          isAuthenticated: true,
          producer: {
            status,
            profile: {
              id: "producer-self",
              displayName: status === "complete" ? "Producer" : null,
              slug: "producer-self",
              email: "producer@example.com",
            },
          },
          artist: { hasAccess: true, hasActiveConnections: true },
        }),
      ).toBe("producer-confirmation");
    },
  );
});
