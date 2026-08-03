import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserAccountMemberships } from "~/server/auth/role";
import {
  JoinContinuationError,
  type JoinTargetProducer,
} from "~/server/contacts/join-continuation";
import { ProjectOwnershipDomainError } from "~/server/domain/project-ownership/service";

type TestCookieStore = {
  get: (name: string) => { value: string } | undefined;
  set: (name: string, value: string, options: unknown) => void;
};

const authMock = vi.fn<() => Promise<{ userId: string | null }>>();
const cookiesMock = vi.fn<() => Promise<TestCookieStore>>();
const connectMock = vi.fn<(input: unknown) => Promise<string>>();
const findTargetMock = vi.fn<(dbUrl: string, slug: string) => Promise<JoinTargetProducer | null>>();
const membershipsMock =
  vi.fn<(input: { dbUrl: string; userId: string | null }) => Promise<UserAccountMemberships>>();
const verifyIntentMock = vi.fn<(input: unknown) => boolean>();
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
  cookies: (): Promise<TestCookieStore> => cookiesMock(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  redirect: (href: string) => redirectMock(href),
}));

vi.mock("~/server/auth/join-intent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/auth/join-intent")>();
  return {
    ...actual,
    joinIntentSecret: () => "test-secret",
    verifyJoinIntentToken: (input: unknown): boolean => verifyIntentMock(input),
  };
});

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
    joinArtistHref: () => "/artist?studio=studio-1",
  };
});

import { continueAsArtist, resumeTrustedJoinIntent } from "./actions";

const target = {
  id: "studio-1",
  clerkUserId: "producer-user",
  displayName: "Northline",
  slug: "northline-studio",
};

function cookieStore() {
  return {
    get: vi.fn(() => ({ value: "trusted-intent" })),
    set: vi.fn(),
  };
}

describe("join continuation actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://test.invalid/skitza";
    authMock.mockResolvedValue({ userId: "artist-user" });
    findTargetMock.mockResolvedValue(target);
    membershipsMock.mockResolvedValue({
      isAuthenticated: true,
      producer: { status: "none", profile: null },
      artist: { hasAccess: false, hasActiveConnections: false },
    });
    verifyIntentMock.mockReturnValue(true);
  });

  it("maps the exact stable-owner conflict to account recovery without consuming intent", async () => {
    const store = cookieStore();
    cookiesMock.mockResolvedValue(store);
    connectMock.mockRejectedValue(
      new ProjectOwnershipDomainError(
        "OWNER_CONFLICT",
        "This client already belongs to another verified account",
      ),
    );

    await expect(continueAsArtist("northline-studio", "book")).rejects.toThrow(
      "__REDIRECT__:/join/northline-studio/continue?action=book&problem=account-conflict",
    );

    expect(store.set).not.toHaveBeenCalled();
  });

  it("does the same for trusted automatic resume and preserves its cookie", async () => {
    const store = cookieStore();
    cookiesMock.mockResolvedValue(store);
    connectMock.mockRejectedValue(
      new ProjectOwnershipDomainError(
        "OWNER_CONFLICT",
        "This client already belongs to another verified account",
      ),
    );

    await expect(resumeTrustedJoinIntent("northline-studio", "unlock")).rejects.toThrow(
      "__REDIRECT__:/join/northline-studio/continue?action=unlock&problem=account-conflict",
    );

    expect(store.set).not.toHaveBeenCalled();
  });

  it("clears the trusted intent only after a successful connection", async () => {
    const store = cookieStore();
    cookiesMock.mockResolvedValue(store);
    connectMock.mockResolvedValue("/artist/book?studio=studio-1");

    await expect(continueAsArtist("northline-studio", "book")).rejects.toThrow(
      "__REDIRECT__:/artist/book?studio=studio-1",
    );

    expect(store.set).toHaveBeenCalledTimes(1);
  });

  it("sends an unverified email to bounded retry and account-switch recovery", async () => {
    const store = cookieStore();
    cookiesMock.mockResolvedValue(store);
    connectMock.mockRejectedValue(
      new JoinContinuationError("UNVERIFIED_EMAIL"),
    );

    await expect(continueAsArtist("northline-studio", "book")).rejects.toThrow(
      "__REDIRECT__:/join/northline-studio/continue?action=book&problem=unverified-email",
    );

    expect(store.set).not.toHaveBeenCalled();
  });

  it("sends an unconfirmed connection to bounded retry recovery", async () => {
    const store = cookieStore();
    cookiesMock.mockResolvedValue(store);
    connectMock.mockRejectedValue(
      new JoinContinuationError("CONNECTION_NOT_CONFIRMED"),
    );

    await expect(
      resumeTrustedJoinIntent("northline-studio", "unlock"),
    ).rejects.toThrow(
      "__REDIRECT__:/join/northline-studio/continue?action=unlock&problem=connection-pending",
    );

    expect(store.set).not.toHaveBeenCalled();
  });

  it("still lets unexpected failures reach the real error boundary", async () => {
    const store = cookieStore();
    cookiesMock.mockResolvedValue(store);
    connectMock.mockRejectedValue(new Error("database unavailable"));

    await expect(continueAsArtist("northline-studio", "book")).rejects.toThrow(
      "database unavailable",
    );

    expect(redirectMock).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });
});
