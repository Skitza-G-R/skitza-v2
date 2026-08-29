import { describe, expect, it, vi } from "vitest";

import { ADMIN_INACTIVITY_TIMEOUT_MS } from "./admin-session";
import {
  requestAdminActivity,
  requestAdminContext,
  requestAdminLock,
  type AdminApiFetch,
} from "./admin-api-requests";

const AJAX_JSON_HEADERS = {
  Accept: "application/json",
  "X-Requested-With": "XMLHttpRequest",
} as const;

function redirectedResponse(
  body: BodyInit | null,
  init: ResponseInit,
): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, "redirected", { value: true });
  return response;
}

describe("admin API request contracts", () => {
  it("marks the context request as same-origin JSON AJAX", async () => {
    const fetcher = vi
      .fn<AdminApiFetch>()
      .mockResolvedValue(Response.json({ environment: { id: "live" } }));
    const signal = new AbortController().signal;

    await requestAdminContext({ fetcher, signal });

    expect(fetcher).toHaveBeenCalledWith("/api/admin/context", {
      cache: "no-store",
      credentials: "same-origin",
      headers: AJAX_JSON_HEADERS,
      signal,
    });
  });

  it("marks the activity request as same-origin JSON AJAX", async () => {
    const fetcher = vi
      .fn<AdminApiFetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));

    await requestAdminActivity(fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/session/activity",
      {
        method: "POST",
        credentials: "same-origin",
        headers: AJAX_JSON_HEADERS,
      },
    );
  });

  it("marks the keepalive lock request as same-origin JSON AJAX", async () => {
    const fetcher = vi
      .fn<AdminApiFetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));

    await requestAdminLock(fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/admin/session/lock", {
      method: "POST",
      credentials: "same-origin",
      headers: AJAX_JSON_HEADERS,
      keepalive: true,
    });
  });
});

describe("admin context response classification", () => {
  it("accepts only exact 200 JSON matching the requested environment", async () => {
    const fetcher = vi
      .fn<AdminApiFetch>()
      .mockResolvedValue(
        Response.json(
          { authorized: true, environment: { id: "live" } },
          { status: 200 },
        ),
      );

    await expect(
      requestAdminContext({ fetcher }),
    ).resolves.toBe("ready");
  });

  it.each([
    [
      "wrong environment",
      Response.json({ environment: { id: "test" } }, { status: 200 }),
    ],
    [
      "wrong status",
      Response.json({ environment: { id: "live" } }, { status: 201 }),
    ],
    [
      "malformed JSON",
      new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ],
  ])("fails safely for %s", async (_label, response) => {
    const fetcher = vi
      .fn<AdminApiFetch>()
      .mockResolvedValue(response);

    await expect(
      requestAdminContext({ fetcher }),
    ).resolves.toBe("failed");
  });

  it.each([
    [
      "401",
      new Response("<html>Access</html>", {
        status: 401,
        headers: { "Content-Type": "text/html" },
      }),
    ],
    [
      "redirect",
      redirectedResponse("<html>Access</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    ],
    [
      "non-JSON",
      new Response("<html>Access</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    ],
  ])("requires top-level Access login for %s", async (_label, response) => {
    const fetcher = vi
      .fn<AdminApiFetch>()
      .mockResolvedValue(response);

    await expect(
      requestAdminContext({ fetcher }),
    ).resolves.toBe("access-login-required");
  });
});

describe("admin activity response classification", () => {
  it("accepts only an exact nonredirected 204", async () => {
    const fetcher = vi
      .fn<AdminApiFetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));

    await expect(requestAdminActivity(fetcher)).resolves.toBe(
      "refreshed",
    );
  });

  it.each([
    [
      "401",
      new Response("<html>Access</html>", {
        status: 401,
        headers: { "Content-Type": "text/html" },
      }),
    ],
    [
      "redirect",
      redirectedResponse(null, {
        status: 204,
      }),
    ],
    [
      "non-JSON",
      new Response("<html>Access</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    ],
  ])("requires top-level Access login for %s", async (_label, response) => {
    const fetcher = vi
      .fn<AdminApiFetch>()
      .mockResolvedValue(response);

    await expect(requestAdminActivity(fetcher)).resolves.toBe(
      "access-login-required",
    );
  });

  it("distinguishes a JSON session lock from Access interruption", async () => {
    const fetcher = vi
      .fn<AdminApiFetch>()
      .mockResolvedValue(
        Response.json(
          { error: "admin_session_locked" },
          { status: 423 },
        ),
      );

    await expect(requestAdminActivity(fetcher)).resolves.toBe(
      "lock-required",
    );
  });

  it.each([
    ["unexpected JSON", () => Promise.resolve(Response.json({}, { status: 500 }))],
    ["network failure", () => Promise.reject(new Error("offline"))],
  ])("fails closed for %s", async (_label, response) => {
    const fetcher = vi.fn<AdminApiFetch>().mockImplementation(response);

    await expect(requestAdminActivity(fetcher)).resolves.toBe(
      "lock-required",
    );
  });
});

describe("admin lock response classification", () => {
  it.each([1, 12_345, ADMIN_INACTIVITY_TIMEOUT_MS])(
    "accepts a valid JSON 409 retry of %sms",
    async (retryAfterMs) => {
      const fetcher = vi
        .fn<AdminApiFetch>()
        .mockResolvedValue(
          Response.json(
            { locked: false, retryAfterMs },
            { status: 409 },
          ),
        );

      await expect(requestAdminLock(fetcher)).resolves.toEqual({
        retryAfterMs,
        status: "retry",
      });
    },
  );

  it.each([
    {},
    { retryAfterMs: 0 },
    { retryAfterMs: -1 },
    { retryAfterMs: ADMIN_INACTIVITY_TIMEOUT_MS + 1 },
    { retryAfterMs: "1000" },
  ])("locks for malformed or out-of-range retry data", async (body) => {
    const fetcher = vi
      .fn<AdminApiFetch>()
      .mockResolvedValue(Response.json(body, { status: 409 }));

    await expect(requestAdminLock(fetcher)).resolves.toEqual({
      status: "locked",
    });
  });

  it.each([
    [
      "401",
      new Response("<html>Access</html>", {
        status: 401,
        headers: { "Content-Type": "text/html" },
      }),
    ],
    [
      "redirect",
      redirectedResponse("<html>Access</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    ],
    [
      "non-JSON",
      new Response("<html>Access</html>", {
        status: 500,
        headers: { "Content-Type": "text/html" },
      }),
    ],
  ])("requires top-level Access login for %s", async (_label, response) => {
    const fetcher = vi
      .fn<AdminApiFetch>()
      .mockResolvedValue(response);

    await expect(requestAdminLock(fetcher)).resolves.toEqual({
      status: "access-login-required",
    });
  });

  it.each([
    [
      "204 locked response",
      () => Promise.resolve(new Response(null, { status: 204 })),
    ],
    [
      "malformed JSON",
      () =>
        Promise.resolve(
          new Response("{", {
            status: 409,
            headers: { "Content-Type": "application/json" },
          }),
        ),
    ],
    [
      "other JSON status",
      () => Promise.resolve(Response.json({}, { status: 500 })),
    ],
    ["network failure", () => Promise.reject(new Error("offline"))],
  ])("fails closed as locked for %s", async (_label, response) => {
    const fetcher = vi.fn<AdminApiFetch>().mockImplementation(response);

    await expect(requestAdminLock(fetcher)).resolves.toEqual({
      status: "locked",
    });
  });
});
