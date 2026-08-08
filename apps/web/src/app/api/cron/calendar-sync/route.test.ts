import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDb: vi.fn(),
  calendarDeliveryRepository: vi.fn(),
  processCalendarSyncJobs: vi.fn(),
  sendSessionCalendarEmail: vi.fn(),
}));

vi.mock("@skitza/db", () => ({ createDb: mocks.createDb }));
vi.mock("~/server/calendar/repository", () => ({
  calendarDeliveryRepository: mocks.calendarDeliveryRepository,
}));
vi.mock("~/server/calendar/delivery", () => ({
  processCalendarSyncJobs: mocks.processCalendarSyncJobs,
}));
vi.mock("~/server/email/send", () => ({
  sendSessionCalendarEmail: mocks.sendSessionCalendarEmail,
}));

import { GET } from "./route";

function request(secret = "cron-test-secret") {
  return new Request("https://skitza.test/api/cron/calendar-sync", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe("GET /api/cron/calendar-sync", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/skitza");
    mocks.createDb.mockReset().mockReturnValue({ kind: "db" });
    mocks.calendarDeliveryRepository.mockReset().mockReturnValue({ kind: "repository" });
    mocks.processCalendarSyncJobs.mockReset().mockResolvedValue({
      claimed: 2,
      completed: 1,
      retried: 1,
      terminal: 0,
      leaseLost: 0,
    });
    mocks.sendSessionCalendarEmail.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects requests when cron auth is absent or incorrect", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const missing = await GET(request());
    expect(missing.status).toBe(503);
    await expect(missing.json()).resolves.toEqual({ ok: false, reason: "missing CRON_SECRET" });

    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    const unauthorized = await GET(request("wrong-secret"));
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({ ok: false, reason: "unauthorized" });
    expect(mocks.createDb).not.toHaveBeenCalled();
  });

  it("fails closed when the database environment is missing", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      reason: "missing DATABASE_URL",
    });
    expect(mocks.createDb).not.toHaveBeenCalled();
  });

  it("drains recoverable jobs without returning recipient or payload data", async () => {
    const response = await GET(request());

    expect(mocks.createDb).toHaveBeenCalledWith("postgresql://test.invalid/skitza");
    expect(mocks.calendarDeliveryRepository).toHaveBeenCalledWith({ kind: "db" });
    expect(mocks.processCalendarSyncJobs).toHaveBeenCalledWith(
      { kind: "repository" },
      mocks.sendSessionCalendarEmail,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      claimed: 2,
      completed: 1,
      retried: 1,
      terminal: 0,
      leaseLost: 0,
    });
  });

  it("returns one sanitized failure without logging provider or database details", async () => {
    mocks.processCalendarSyncJobs.mockRejectedValueOnce(
      new Error("provider rejected ari@example.com postgresql://secret"),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      reason: "calendar delivery failed",
    });
    expect(error).toHaveBeenCalledWith("[cron] calendar sync worker failed");
  });
});
