import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";

import { checkRateLimit } from "~/lib/rate-limit/in-memory";

// The waitlist router POSTs signups to a Make.com webhook. We mock
// next/headers (for IP + UA), the rate-limit util, and global fetch
// so the test exercises the procedure in isolation — no DB, no
// network. Fetch is stubbed at the global level since the procedure
// uses the platform fetch directly (no axios/ofetch wrapper).

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve(
      new Headers({
        "x-forwarded-for": "203.0.113.42",
        "user-agent": "Mozilla/5.0 (Test)",
      }),
    ),
}));

vi.mock("~/lib/rate-limit/in-memory", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true, remaining: 4, resetMs: 0 })),
}));

import { waitlistRouter } from "../waitlist";

const caller = waitlistRouter.createCaller({ userId: null });

describe("waitlist.signup — happy path", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.MAKE_WAITLIST_WEBHOOK_URL = "https://hook.test/abc123";
  });

  afterEach(() => {
    delete process.env.MAKE_WAITLIST_WEBHOOK_URL;
  });

  it("POSTs the payload to the webhook and returns ok", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await caller.signup({
      email: "yuval@example.com",
      firstName: "Yuval",
      locale: "en",
    });

    expect(result).toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch not called");
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe("https://hook.test/abc123");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      email: "yuval@example.com",
      firstName: "Yuval",
      locale: "en",
      ipAddress: "203.0.113.42",
      userAgent: "Mozilla/5.0 (Test)",
    });
    expect(body.signedUpAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("normalizes email to lowercase + trimmed", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await caller.signup({
      email: "  YUVAL@Example.COM  ",
      locale: "he",
    });

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch not called");
    const [, init] = call as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.email).toBe("yuval@example.com");
  });
});

describe("waitlist.signup — rate limiting", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.MAKE_WAITLIST_WEBHOOK_URL = "https://hook.test/abc";
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      remaining: 4,
      resetMs: 0,
    });
  });

  afterEach(() => {
    delete process.env.MAKE_WAITLIST_WEBHOOK_URL;
  });

  it("throws TOO_MANY_REQUESTS when rate limit exceeded — webhook NOT called", async () => {
    vi.mocked(checkRateLimit).mockReturnValueOnce({
      ok: false,
      remaining: 0,
      resetMs: 12_000,
    });

    await expect(
      caller.signup({ email: "yuval@example.com", locale: "en" }),
    ).rejects.toThrow(/Too many signups/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses IP-keyed bucket with limit=5, window=1 hour", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await caller.signup({ email: "y@example.com", locale: "en" });
    expect(checkRateLimit).toHaveBeenCalledWith(
      "waitlist:203.0.113.42",
      5,
      3_600_000,
    );
  });
});

describe("waitlist.signup — honeypot", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.MAKE_WAITLIST_WEBHOOK_URL = "https://hook.test/abc";
  });

  afterEach(() => {
    delete process.env.MAKE_WAITLIST_WEBHOOK_URL;
  });

  it("returns ok WITHOUT firing the webhook when company field is non-empty", async () => {
    const result = await caller.signup({
      email: "bot@spam.com",
      locale: "en",
      company: "definitely-a-bot",
    });
    expect(result).toEqual({ status: "ok" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("waitlist.signup — webhook failure modes", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      remaining: 4,
      resetMs: 0,
    });
  });

  afterEach(() => {
    delete process.env.MAKE_WAITLIST_WEBHOOK_URL;
  });

  it("throws INTERNAL_SERVER_ERROR when MAKE_WAITLIST_WEBHOOK_URL is not configured", async () => {
    delete process.env.MAKE_WAITLIST_WEBHOOK_URL;
    await expect(
      caller.signup({ email: "y@example.com", locale: "en" }),
    ).rejects.toThrow(/temporarily unavailable/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws INTERNAL_SERVER_ERROR when webhook returns 500", async () => {
    process.env.MAKE_WAITLIST_WEBHOOK_URL = "https://hook.test/abc";
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    await expect(
      caller.signup({ email: "y@example.com", locale: "en" }),
    ).rejects.toThrow(/Could not save/);
  });

  it("throws INTERNAL_SERVER_ERROR when webhook fetch aborts (timeout)", async () => {
    process.env.MAKE_WAITLIST_WEBHOOK_URL = "https://hook.test/abc";
    fetchMock.mockRejectedValueOnce(
      new DOMException("aborted", "AbortError"),
    );
    await expect(
      caller.signup({ email: "y@example.com", locale: "en" }),
    ).rejects.toThrow(/Could not save/);
  });
});
