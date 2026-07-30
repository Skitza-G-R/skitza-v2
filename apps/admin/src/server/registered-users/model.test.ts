import { describe, expect, it } from "vitest";

import {
  DIRECTORY_PAGE_SIZE,
  decodeRegisteredUserCursor,
  deriveRegisteredUserActivation,
  deriveRegisteredUserRoles,
  encodeRegisteredUserCursor,
  matchesRegisteredUserRole,
  parseRegisteredUserDirectoryQuery,
  registeredUserFilterDigest,
} from "./model";

describe("registered user model", () => {
  it.each([
    [{ hasArtistRelationships: false, hasProducer: true }, ["Producer"]],
    [{ hasArtistRelationships: true, hasProducer: false }, ["Artist"]],
    [{ hasArtistRelationships: true, hasProducer: true }, ["Producer", "Artist"]],
    [{ hasArtistRelationships: false, hasProducer: false }, []],
  ] as const)("derives one person's real roles from mappings", (facts, roles) => {
    expect(deriveRegisteredUserRoles(facts)).toEqual(roles);
  });

  it("includes dual-role people under Producer and Artist while Both is exact", () => {
    const both = ["Producer", "Artist"] as const;

    expect(matchesRegisteredUserRole(both, "producer")).toBe(true);
    expect(matchesRegisteredUserRole(both, "artist")).toBe(true);
    expect(matchesRegisteredUserRole(both, "both")).toBe(true);
    expect(matchesRegisteredUserRole(["Producer"], "both")).toBe(false);
    expect(matchesRegisteredUserRole(["Artist"], "producer")).toBe(false);
  });

  it("normalizes a complete shareable directory query", () => {
    expect(
      parseRegisteredUserDirectoryQuery({
        activation: "not-activated",
        activity: "30d",
        dir: "asc",
        onboarding: "not-complete",
        cursor: "opaque_123",
        q: "  maya@example.com  ",
        role: "producer",
        signup: "month",
        sort: "signup",
        status: "needs-attention",
      }),
    ).toEqual({
      activation: "not-activated",
      activity: "30d",
      cursor: "opaque_123",
      direction: "asc",
      onboarding: "not-complete",
      pageSize: DIRECTORY_PAGE_SIZE,
      query: "maya@example.com",
      role: "producer",
      signup: "month",
      sort: "signup",
      status: "needs-attention",
    });
  });

  it("fails safely to compact defaults for invalid or oversized URL input", () => {
    const parsed = parseRegisteredUserDirectoryQuery({
      activation: "invented",
      activity: ["7d", "30d"],
      dir: "sideways",
      onboarding: "complete",
      cursor: "not valid!",
      q: "x".repeat(400),
      role: "owner",
      signup: "forever",
      sort: "private-note",
      status: "suspended",
    });

    expect(parsed).toEqual({
      activation: "all",
      activity: "all",
      cursor: null,
      direction: "desc",
      onboarding: "complete",
      pageSize: DIRECTORY_PAGE_SIZE,
      query: "x".repeat(100),
      role: "all",
      signup: "all",
      sort: "signup",
      status: "all",
    });
  });

  it("binds opaque cursors to the exact environment and filters", () => {
    const query = parseRegisteredUserDirectoryQuery({
      q: "maya",
      role: "artist",
      sort: "name",
    });
    const filterDigest = registeredUserFilterDigest("test", query);
    const encoded = encodeRegisteredUserCursor({
      clerkUserId: "user_maya",
      direction: "after",
      environment: "test",
      filterDigest,
      nullRank: 0,
      sortValue: "maya levi",
      version: 1,
    });

    expect(
      decodeRegisteredUserCursor(encoded, {
        environment: "test",
        filterDigest,
      }),
    ).toEqual({
      clerkUserId: "user_maya",
      direction: "after",
      environment: "test",
      filterDigest,
      nullRank: 0,
      sortValue: "maya levi",
      version: 1,
    });
    expect(() =>
      decodeRegisteredUserCursor(encoded, {
        environment: "live",
        filterDigest,
      }),
    ).toThrow("INVALID_REGISTERED_USER_CURSOR");
    expect(() =>
      decodeRegisteredUserCursor(encoded, {
        environment: "test",
        filterDigest: "0".repeat(64),
      }),
    ).toThrow("INVALID_REGISTERED_USER_CURSOR");
  });

  it("rejects inconsistent or non-canonical cursor sort values", () => {
    const query = parseRegisteredUserDirectoryQuery({ sort: "signup" });
    const common = {
      clerkUserId: "user_maya",
      direction: "after" as const,
      environment: "test" as const,
      filterDigest: registeredUserFilterDigest("test", query),
      version: 1 as const,
    };
    const decode = (cursor: Parameters<typeof encodeRegisteredUserCursor>[0]) =>
      decodeRegisteredUserCursor(encodeRegisteredUserCursor(cursor), {
        environment: "test",
        filterDigest: common.filterDigest,
        sort: "signup",
      });

    expect(() =>
      decode({ ...common, nullRank: 0, sortValue: null }),
    ).toThrow("INVALID_REGISTERED_USER_CURSOR");
    expect(() =>
      decode({ ...common, nullRank: 1, sortValue: "not-null" }),
    ).toThrow("INVALID_REGISTERED_USER_CURSOR");
    expect(() =>
      decode({ ...common, nullRank: 0, sortValue: "garbage" }),
    ).toThrow("INVALID_REGISTERED_USER_CURSOR");
    expect(
      decode({ ...common, nullRank: 1, sortValue: null }),
    ).toMatchObject({ nullRank: 1, sortValue: null });
  });

  it("includes the exact day-14 activation boundary and ignores later events", () => {
    const registeredAt = new Date("2026-07-01T00:00:00.000Z");
    const day14 = new Date("2026-07-15T00:00:00.000Z");
    const common = {
      audienceType: "external" as const,
      environment: "live" as const,
      hasProducer: true,
      hasUnclassifiedEventInWindow: false,
      now: new Date("2026-07-30T00:00:00.000Z"),
      producerCreatedAt: registeredAt,
    };

    expect(
      deriveRegisteredUserActivation({
        ...common,
        firstExternalEventAt: day14,
      }),
    ).toBe("Activated");
    expect(
      deriveRegisteredUserActivation({
        ...common,
        firstExternalEventAt: new Date(day14.getTime() + 1),
      }),
    ).toBe("Not activated");
  });
});
