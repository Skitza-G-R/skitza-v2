import { describe, expect, it, vi } from "vitest";

import {
  isSuccessfulAdminUnlock,
  requestAdminUnlock,
  type AdminUnlockFetch,
} from "./unlock-request";

describe("admin unlock request", () => {
  it("returns Clerk's reverification hint for useReverification to inspect", async () => {
    const hint = {
      clerk_error: {
        metadata: { reverification: "strict_mfa" },
        reason: "reverification-error",
        type: "forbidden",
      },
    };
    const reverificationResponse = new Response(
      JSON.stringify(hint),
      { status: 403 },
    );
    const fetcher = vi.fn<AdminUnlockFetch>().mockResolvedValue(
      reverificationResponse,
    );

    const result = await requestAdminUnlock(fetcher);

    expect(result).toEqual(hint);
    expect(isSuccessfulAdminUnlock(result)).toBe(false);
  });

  it("recognizes the successful response returned after Clerk retries", async () => {
    const successResponse = Response.json({ unlocked: true });
    const fetcher = vi.fn<AdminUnlockFetch>().mockResolvedValue(successResponse);

    const response = await requestAdminUnlock(fetcher);

    expect(isSuccessfulAdminUnlock(response)).toBe(true);
  });

  it("preserves the hint and recognizes the successful automatic retry", async () => {
    const fetcher = vi
      .fn<AdminUnlockFetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            clerk_error: {
              metadata: { reverification: "strict_mfa" },
              reason: "reverification-error",
              type: "forbidden",
            },
          },
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ unlocked: true }));

    const hint = await requestAdminUnlock(fetcher);
    const retried = await requestAdminUnlock(fetcher);

    expect(hint).toHaveProperty(
      "clerk_error.metadata.reverification",
      "strict_mfa",
    );
    expect(isSuccessfulAdminUnlock(retried)).toBe(true);
  });
});
