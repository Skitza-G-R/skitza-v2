import { beforeEach, describe, expect, it, vi } from "vitest";

// Chain mock for db.insert().values().onConflictDoNothing()
const onConflictDoNothingMock = vi
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);
const valuesMock = vi.fn<(values: Record<string, unknown>) => {
  onConflictDoNothing: typeof onConflictDoNothingMock;
}>(() => ({ onConflictDoNothing: onConflictDoNothingMock }));
const insertMock = vi.fn(() => ({ values: valuesMock }));
const dbMock = { insert: insertMock };

vi.mock("@skitza/db", () => ({
  createDb: () => dbMock,
  waitlist: { email: "email" },
}));

// next/headers is server-only; we supply a deterministic Headers instance
// so ipHash + userAgent tests are stable.
vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve(
      new Headers({
        "x-forwarded-for": "1.2.3.4",
        "user-agent": "vt",
      }),
    ),
}));

beforeEach(() => {
  insertMock.mockClear();
  valuesMock.mockClear();
  onConflictDoNothingMock.mockReset().mockResolvedValue(undefined);
  process.env.DATABASE_URL = "postgresql://test/test";
});

describe("joinWaitlist", () => {
  it("accepts a well-formed email + source + inserts with hashed ip", async () => {
    const { joinWaitlist } = await import("./waitlist");
    const res = await joinWaitlist({
      email: "ada@example.com",
      source: "landing-hero",
    });
    expect(res.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledOnce();
    const inserted = valuesMock.mock.calls[0]?.[0];
    expect(inserted).toMatchObject({
      email: "ada@example.com",
      source: "landing-hero",
      userAgent: "vt",
    });
    // sha256 hex is 64 lowercase hex chars.
    expect(inserted?.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects an invalid email via zod", async () => {
    const { joinWaitlist } = await import("./waitlist");
    const res = await joinWaitlist({ email: "not-an-email" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.toLowerCase()).toMatch(/email|invalid/);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns ok:true when the email is already on the list (idempotent on conflict)", async () => {
    // ON CONFLICT DO NOTHING — insert call resolves normally even for dups.
    const { joinWaitlist } = await import("./waitlist");
    const res = await joinWaitlist({ email: "dup@example.com" });
    expect(res.ok).toBe(true);
  });

  it("returns ok:false when the DB throws", async () => {
    onConflictDoNothingMock.mockRejectedValueOnce(new Error("connection refused"));
    const { joinWaitlist } = await import("./waitlist");
    const res = await joinWaitlist({ email: "ok@example.com" });
    expect(res.ok).toBe(false);
  });
});
