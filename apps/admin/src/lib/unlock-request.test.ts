import { describe, expect, it, vi } from "vitest";

import {
  isSuccessfulAdminUnlock,
  requestAdminUnlock,
  type AdminUnlockFetch,
} from "./unlock-request";

const UNLOCK_ENDPOINT = "/api/admin/session/unlock";
const ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";

function redirectedResponse(
  body: BodyInit | null,
  init: ResponseInit,
): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, "redirected", { value: true });
  return response;
}

describe("admin unlock request", () => {
  it("posts a same-origin JSON request marked as AJAX", async () => {
    const fetcher = vi
      .fn<AdminUnlockFetch>()
      .mockResolvedValue(Response.json({ unlocked: true }));

    await requestAdminUnlock(fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(UNLOCK_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
  });

  it("accepts the exact 200 JSON success response", async () => {
    const fetcher = vi
      .fn<AdminUnlockFetch>()
      .mockResolvedValue(
        Response.json({ unlocked: true }, { status: 200 }),
      );

    const result = await requestAdminUnlock(fetcher);

    expect(result).toEqual({ unlocked: true });
    expect(isSuccessfulAdminUnlock(result)).toBe(true);
  });

  it("accepts only the exact Cloudflare reauthentication contract", async () => {
    const fetcher = vi
      .fn<AdminUnlockFetch>()
      .mockResolvedValue(
        Response.json(
          {
            error: "cloudflare_reauthentication_required",
            logoutPath: ACCESS_LOGOUT_PATH,
          },
          { status: 409 },
        ),
      );

    const result = await requestAdminUnlock(fetcher);

    expect(result).toEqual({
      logoutPath: ACCESS_LOGOUT_PATH,
      reauthenticationRequired: true,
      unlocked: false,
    });
    expect(isSuccessfulAdminUnlock(result)).toBe(false);
  });

  it.each([
    "https://attacker.example/logout",
    "/another/logout",
    `${ACCESS_LOGOUT_PATH}?returnTo=/`,
  ])("rejects an untrusted reauthentication logout path: %s", async (logoutPath) => {
    const fetcher = vi
      .fn<AdminUnlockFetch>()
      .mockResolvedValue(
        Response.json(
          {
            error: "cloudflare_reauthentication_required",
            logoutPath,
          },
          { status: 409 },
        ),
      );

    await expect(requestAdminUnlock(fetcher)).resolves.toEqual({
      failed: true,
      unlocked: false,
    });
  });

  it("treats a 401 Access HTML response as requiring top-level Access login", async () => {
    const fetcher = vi
      .fn<AdminUnlockFetch>()
      .mockResolvedValue(
        new Response("<html>Cloudflare Access</html>", {
          status: 401,
          headers: { "Content-Type": "text/html" },
        }),
      );

    await expect(requestAdminUnlock(fetcher)).resolves.toEqual({
      accessLoginRequired: true,
      unlocked: false,
    });
  });

  it("treats redirected 200 HTML as requiring top-level Access login", async () => {
    const fetcher = vi
      .fn<AdminUnlockFetch>()
      .mockResolvedValue(
        redirectedResponse("<html>Cloudflare Access</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      );

    await expect(requestAdminUnlock(fetcher)).resolves.toEqual({
      accessLoginRequired: true,
      unlocked: false,
    });
  });

  it.each([
    ["missing", undefined],
    ["text/plain", "text/plain"],
    ["text/html", "text/html; charset=utf-8"],
  ])(
    "does not parse a success body with %s content type",
    async (_label, contentType) => {
      const responseInit: ResponseInit = contentType
        ? {
            status: 200,
            headers: { "Content-Type": contentType },
          }
        : { status: 200 };
      const fetcher = vi
        .fn<AdminUnlockFetch>()
        .mockResolvedValue(
          new Response(
            new TextEncoder().encode(JSON.stringify({ unlocked: true })),
            responseInit,
          ),
        );

      await expect(requestAdminUnlock(fetcher)).resolves.toEqual({
        accessLoginRequired: true,
        unlocked: false,
      });
    },
  );

  it("fails safely when an application/json body is malformed", async () => {
    const fetcher = vi
      .fn<AdminUnlockFetch>()
      .mockResolvedValue(
        new Response("{", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    await expect(requestAdminUnlock(fetcher)).resolves.toEqual({
      failed: true,
      unlocked: false,
    });
  });

  it.each([400, 403, 404, 409, 422, 429, 500, 502, 503])(
    "fails safely for unexpected JSON status %s",
    async (status) => {
      const fetcher = vi
        .fn<AdminUnlockFetch>()
        .mockResolvedValue(
          Response.json({ error: "unexpected" }, { status }),
        );

      const result = await requestAdminUnlock(fetcher);

      expect(result).toEqual({ failed: true, unlocked: false });
      expect(isSuccessfulAdminUnlock(result)).toBe(false);
    },
  );

  it.each([
    {},
    { unlocked: false },
    { unlocked: "true" },
    { error: "cloudflare_reauthentication_required" },
  ])("fails safely for an unexpected 200 JSON body", async (body) => {
    const fetcher = vi
      .fn<AdminUnlockFetch>()
      .mockResolvedValue(Response.json(body, { status: 200 }));

    await expect(requestAdminUnlock(fetcher)).resolves.toEqual({
      failed: true,
      unlocked: false,
    });
  });
});
