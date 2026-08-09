import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDb: vi.fn(),
  calendarDeliveryRepository: vi.fn(),
  processCalendarSyncJobs: vi.fn(),
  processGoogleCalendarSyncJobs: vi.fn(),
  sendSessionCalendarEmail: vi.fn(),
  createGoogleCalendarProvider: vi.fn(),
  createGoogleCalendarRepository: vi.fn(),
  createGoogleCalendarWorkerAccess: vi.fn(),
  enqueueFutureConfirmedEvents: vi.fn(),
  isGoogleCalendarServerConfigured: vi.fn(),
  loadGoogleCalendarServerConfig: vi.fn(),
}));

vi.mock("@skitza/db", () => ({ createDb: mocks.createDb }));
vi.mock("~/server/calendar/repository", () => ({
  calendarDeliveryRepository: mocks.calendarDeliveryRepository,
}));
vi.mock("~/server/calendar/delivery", () => ({
  processCalendarSyncJobs: mocks.processCalendarSyncJobs,
}));
vi.mock("~/server/calendar/google-delivery", () => ({
  processGoogleCalendarSyncJobs: mocks.processGoogleCalendarSyncJobs,
}));
vi.mock("~/server/email/send", () => ({
  sendSessionCalendarEmail: mocks.sendSessionCalendarEmail,
}));
vi.mock("~/server/google-calendar", () => ({
  createGoogleCalendarProvider: mocks.createGoogleCalendarProvider,
  createGoogleCalendarRepository: mocks.createGoogleCalendarRepository,
  createGoogleCalendarWorkerAccess: mocks.createGoogleCalendarWorkerAccess,
  isGoogleCalendarServerConfigured: mocks.isGoogleCalendarServerConfigured,
  loadGoogleCalendarServerConfig: mocks.loadGoogleCalendarServerConfig,
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
    mocks.enqueueFutureConfirmedEvents.mockReset().mockResolvedValue({
      scanned: 2,
      linksCreated: 1,
      jobsEnqueued: 1,
      jobIds: ["00000000-0000-4000-8000-000000000003"],
    });
    mocks.createGoogleCalendarRepository.mockReset().mockReturnValue({
      kind: "google-repository",
      enqueueFutureConfirmedEvents: mocks.enqueueFutureConfirmedEvents,
    });
    mocks.createGoogleCalendarProvider.mockReset().mockReturnValue({ kind: "provider" });
    mocks.createGoogleCalendarWorkerAccess.mockReset().mockReturnValue({ kind: "access" });
    mocks.isGoogleCalendarServerConfigured.mockReset().mockReturnValue(true);
    mocks.loadGoogleCalendarServerConfig.mockReset().mockReturnValue({ kind: "config" });
    mocks.processGoogleCalendarSyncJobs.mockReset().mockResolvedValue({
      claimed: 1,
      completed: 0,
      retried: 1,
      terminal: 0,
      leaseLost: 0,
      fallbackEnqueued: 1,
      fallbackJobIds: ["00000000-0000-4000-8000-000000000002"],
    });
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
    expect(mocks.enqueueFutureConfirmedEvents).toHaveBeenCalledTimes(1);
    const [initialSyncInput] = mocks.enqueueFutureConfirmedEvents.mock.calls[0] as [
      { now: Date; limit: number },
    ];
    expect(initialSyncInput.now).toBeInstanceOf(Date);
    expect(initialSyncInput.limit).toBe(100);
    expect(mocks.processGoogleCalendarSyncJobs).toHaveBeenCalledWith({
      repository: { kind: "repository" },
      provider: { kind: "provider" },
      access: { kind: "access" },
    });
    expect(mocks.processCalendarSyncJobs).toHaveBeenNthCalledWith(
      1,
      { kind: "repository" },
      mocks.sendSessionCalendarEmail,
      { jobId: "00000000-0000-4000-8000-000000000002", limit: 1 },
    );
    expect(mocks.processCalendarSyncJobs).toHaveBeenNthCalledWith(
      2,
      { kind: "repository" },
      mocks.sendSessionCalendarEmail,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      initialSync: {
        scanned: 2,
        linksCreated: 1,
        jobsEnqueued: 1,
      },
      google: {
        claimed: 1,
        completed: 0,
        retried: 1,
        terminal: 0,
        leaseLost: 0,
        fallbackEnqueued: 1,
      },
      ics: {
        claimed: 2,
        completed: 1,
        retried: 1,
        terminal: 0,
        leaseLost: 0,
      },
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
