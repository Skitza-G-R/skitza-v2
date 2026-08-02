import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserAccountMemberships } from "~/server/auth/role";
import type { JoinTargetProducer } from "~/server/contacts/join-continuation";
import { ProjectOwnershipDomainError } from "~/server/domain/project-ownership/service";

const authMock = vi.fn<() => Promise<{ userId: string | null }>>();
const connectMock = vi.fn<(input: unknown) => Promise<string>>();
const findTargetMock = vi.fn<(dbUrl: string, slug: string) => Promise<JoinTargetProducer | null>>();
const membershipsMock =
  vi.fn<(input: { dbUrl: string; userId: string | null }) => Promise<UserAccountMemberships>>();
const redirectMock = vi.fn((href: string) => {
  throw new Error(`__REDIRECT__:${href}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("__NOT_FOUND__");
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: (href: string) => redirectMock(href),
}));

vi.mock("~/server/auth/role", () => ({
  fetchUserAccountMemberships: (input: {
    dbUrl: string;
    userId: string | null;
  }): Promise<UserAccountMemberships> => membershipsMock(input),
}));

vi.mock("~/server/contacts/join-continuation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/contacts/join-continuation")>();
  return {
    ...actual,
    connectCurrentUserForJoin: (input: unknown): Promise<string> => connectMock(input),
    findJoinTargetProducer: (dbUrl: string, slug: string): Promise<JoinTargetProducer | null> =>
      findTargetMock(dbUrl, slug),
    isSelfJoin: () => false,
    joinArtistHref: () => "/artist?studio=studio-1",
  };
});

import { startJoinBooking, startJoinUnlock } from "./actions";

const target: JoinTargetProducer = {
  id: "studio-1",
  clerkUserId: "producer-user",
  displayName: "Northline",
  slug: "northline-studio",
};

describe("public join actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://test.invalid/skitza";
    authMock.mockResolvedValue({ userId: "artist-user" });
    findTargetMock.mockResolvedValue(target);
    membershipsMock.mockResolvedValue({
      isAuthenticated: true,
      producer: { status: "none", profile: null },
      artist: { hasAccess: true, hasActiveConnections: true },
    });
  });

  it.each([
    ["booking", startJoinBooking, "book"],
    ["unlock", startJoinUnlock, "unlock"],
  ] as const)(
    "maps an authenticated %s ownership conflict to safe recovery",
    async (_label, startJoin, action) => {
      connectMock.mockRejectedValue(
        new ProjectOwnershipDomainError(
          "OWNER_CONFLICT",
          "This client already belongs to another verified account",
        ),
      );

      await expect(startJoin("northline-studio")).rejects.toThrow(
        `__REDIRECT__:/join/northline-studio/continue?action=${action}&problem=account-conflict`,
      );
    },
  );

  it("still lets unexpected connection failures reach the real error boundary", async () => {
    connectMock.mockRejectedValue(new Error("database unavailable"));

    await expect(startJoinBooking("northline-studio")).rejects.toThrow("database unavailable");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
