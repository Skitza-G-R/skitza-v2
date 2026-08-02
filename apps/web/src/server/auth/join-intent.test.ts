import { describe, expect, it, vi } from "vitest";

import {
  clearJoinIntentCookie,
  clearedJoinIntentCookieOptions,
  issueJoinIntentToken,
  joinIntentCookieOptions,
  verifyJoinIntentToken,
  verifiedJoinIntentAction,
} from "./join-intent";

const NOW = Date.UTC(2026, 7, 1, 12, 0, 0);
const SECRET = "test-only-join-intent-secret";

describe("trusted join intent", () => {
  it("round-trips only the expected slug and action before expiry", () => {
    const token = issueJoinIntentToken({
      slug: "northline-studio",
      action: "book",
      secret: SECRET,
      nowMs: NOW,
    });
    expect(
      verifyJoinIntentToken({
        token,
        expectedSlug: "northline-studio",
        expectedAction: "book",
        secret: SECRET,
        nowMs: NOW + 60_000,
      }),
    ).toBe(true);
    expect(
      verifyJoinIntentToken({
        token,
        expectedSlug: "another-studio",
        expectedAction: "book",
        secret: SECRET,
        nowMs: NOW + 60_000,
      }),
    ).toBe(false);
  });

  it("rejects missing, expired, and forged intent", () => {
    const token = issueJoinIntentToken({
      slug: "northline-studio",
      action: "book",
      secret: SECRET,
      nowMs: NOW,
    });
    expect(
      verifyJoinIntentToken({
        token: null,
        expectedSlug: "northline-studio",
        expectedAction: "book",
        secret: SECRET,
        nowMs: NOW,
      }),
    ).toBe(false);
    expect(
      verifyJoinIntentToken({
        token,
        expectedSlug: "northline-studio",
        expectedAction: "book",
        secret: SECRET,
        nowMs: NOW + 11 * 60_000,
      }),
    ).toBe(false);
    expect(
      verifyJoinIntentToken({
        token: `${token?.slice(0, -1) ?? ""}x`,
        expectedSlug: "northline-studio",
        expectedAction: "book",
        secret: SECRET,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("uses a short-lived HttpOnly host cookie", () => {
    expect(joinIntentCookieOptions(true)).toEqual({
      httpOnly: true,
      maxAge: 600,
      path: "/join",
      sameSite: "lax",
      secure: true,
    });
  });

  it("keeps unlock intent separate from booking intent", () => {
    const token = issueJoinIntentToken({
      slug: "northline-studio",
      action: "unlock",
      secret: SECRET,
      nowMs: NOW,
    });

    expect(
      verifiedJoinIntentAction({
        token,
        expectedSlug: "northline-studio",
        secret: SECRET,
        nowMs: NOW,
      }),
    ).toBe("unlock");
    expect(
      verifyJoinIntentToken({
        token,
        expectedSlug: "northline-studio",
        expectedAction: "book",
        secret: SECRET,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("consumes the cookie with an exact /join-path tombstone", () => {
    const set = vi.fn();
    clearJoinIntentCookie({ set }, true);

    expect(clearedJoinIntentCookieOptions(true)).toEqual({
      httpOnly: true,
      expires: new Date(0),
      maxAge: 0,
      path: "/join",
      sameSite: "lax",
      secure: true,
    });
    expect(set).toHaveBeenCalledWith(
      "skitza-join-intent",
      "",
      clearedJoinIntentCookieOptions(true),
    );
  });

  it.each(["---", "-studio", "studio-", "s".repeat(48)])(
    "accepts persisted public-slug boundary %s",
    (slug) => {
      expect(
        issueJoinIntentToken({
          slug,
          action: "book",
          secret: SECRET,
          nowMs: NOW,
        }),
      ).not.toBeNull();
    },
  );

  it.each(["ab", "s".repeat(49), "Studio", "studio/other"])(
    "rejects unsafe or out-of-contract slug %s",
    (slug) => {
      expect(
        issueJoinIntentToken({
          slug,
          action: "book",
          secret: SECRET,
          nowMs: NOW,
        }),
      ).toBeNull();
    },
  );
});
