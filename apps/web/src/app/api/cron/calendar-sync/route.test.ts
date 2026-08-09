import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDb: vi.fn(),
  calendarDeliveryRepository: vi.fn(),
  processCalendarSyncJobs: vi.fn(),
  processGoogleCalendarSyncJobs: vi.fn(),
  processGoogleCalendarReconciliations: vi.fn(),
  sendSessionCalendarEmail: vi.fn(),
  sessionBookingRepository: vi.fn(),
  applyGoogleCalendarSessionReconciliation: vi.fn(),
  createGoogleCalendarProvider: vi.fn(),
  createGoogleCalendarRepository: vi.fn(),
  createGoogleCalendarLinkedEventReader: vi.fn(),
  createGoogleCalendarService: vi.fn(),
  createGoogleCalendarWorkerAccess: vi.fn(),
  enqueueFutureConfirmedEvents: vi.fn(),
  enqueueGoogleReconciliationRecovery: vi.fn(),
  maintainWatches: vi.fn(),
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
vi.mock("~/server/calendar/google-reconciliation", () => ({
  processGoogleCalendarReconciliations: mocks.processGoogleCalendarReconciliations,
}));
vi.mock("~/server/domain/session-booking/db", () => ({
  sessionBookingRepository: mocks.sessionBookingRepository,
}));
vi.mock("~/server/domain/session-booking/service", () => ({
  applyGoogleCalendarSessionReconciliation: mocks.applyGoogleCalendarSessionReconciliation,
}));
vi.mock("~/server/email/send", () => ({
  sendSessionCalendarEmail: mocks.sendSessionCalendarEmail,
}));
vi.mock("~/server/google-calendar", () => ({
  createGoogleCalendarProvider: mocks.createGoogleCalendarProvider,
  createGoogleCalendarRepository: mocks.createGoogleCalendarRepository,
  createGoogleCalendarLinkedEventReader: mocks.createGoogleCalendarLinkedEventReader,
  createGoogleCalendarService: mocks.createGoogleCalendarService,
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
    mocks.enqueueGoogleReconciliationRecovery.mockReset().mockResolvedValue({
      scanned: 3,
      jobsEnqueued: 2,
    });
    mocks.calendarDeliveryRepository.mockReset().mockReturnValue({
      kind: "repository",
      enqueueGoogleReconciliationRecovery: mocks.enqueueGoogleReconciliationRecovery,
    });
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
    mocks.createGoogleCalendarLinkedEventReader.mockReset().mockReturnValue({ kind: "reader" });
    mocks.maintainWatches.mockReset().mockResolvedValue({
      scanned: 2,
      created: 1,
      renewed: 1,
      active: 2,
      failed: 0,
    });
    mocks.createGoogleCalendarService.mockReset().mockReturnValue({
      maintainWatches: mocks.maintainWatches,
    });
    mocks.createGoogleCalendarWorkerAccess.mockReset().mockReturnValue({ kind: "access" });
    mocks.sessionBookingRepository.mockReset().mockReturnValue({ kind: "booking-repository" });
    mocks.applyGoogleCalendarSessionReconciliation.mockReset().mockResolvedValue({
      outcome: "unchanged",
    });
    mocks.processGoogleCalendarReconciliations.mockReset().mockResolvedValue({
      claimed: 2,
      reconciled: 1,
      unchanged: 0,
      missing: 0,
      conflicts: 0,
      corrected: 1,
      disconnected: 0,
      retried: 0,
      terminal: 0,
      leaseLost: 0,
    });
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
    expect(mocks.enqueueGoogleReconciliationRecovery).toHaveBeenCalledTimes(1);
    const [recoveryInput] = mocks.enqueueGoogleReconciliationRecovery.mock.calls[0] as [
      { now: Date; limit: number },
    ];
    expect(recoveryInput.now).toBeInstanceOf(Date);
    expect(recoveryInput.limit).toBe(100);
    expect(mocks.enqueueFutureConfirmedEvents).toHaveBeenCalledTimes(1);
    const [initialSyncInput] = mocks.enqueueFutureConfirmedEvents.mock.calls[0] as [
      { now: Date; limit: number },
    ];
    expect(initialSyncInput.now).toBeInstanceOf(Date);
    expect(initialSyncInput.limit).toBe(100);
    expect(mocks.processGoogleCalendarSyncJobs).toHaveBeenCalledWith({
      repository: {
        kind: "repository",
        enqueueGoogleReconciliationRecovery: mocks.enqueueGoogleReconciliationRecovery,
      },
      provider: { kind: "provider" },
      access: { kind: "access" },
    });
    expect(mocks.maintainWatches).toHaveBeenCalledWith({ limit: 25 });
    expect(mocks.processGoogleCalendarReconciliations).toHaveBeenCalledTimes(1);
    const [reconciliationDependencies] = mocks.processGoogleCalendarReconciliations.mock
      .calls[0] as [
      {
        repository: unknown;
        reader: unknown;
        apply: unknown;
      },
    ];
    expect(reconciliationDependencies.repository).toEqual({
      kind: "repository",
      enqueueGoogleReconciliationRecovery: mocks.enqueueGoogleReconciliationRecovery,
    });
    expect(reconciliationDependencies.reader).toEqual({ kind: "reader" });
    expect(typeof reconciliationDependencies.apply).toBe("function");
    expect(mocks.processCalendarSyncJobs).toHaveBeenNthCalledWith(
      1,
      {
        kind: "repository",
        enqueueGoogleReconciliationRecovery: mocks.enqueueGoogleReconciliationRecovery,
      },
      mocks.sendSessionCalendarEmail,
      { jobId: "00000000-0000-4000-8000-000000000002", limit: 1 },
    );
    expect(mocks.processCalendarSyncJobs).toHaveBeenNthCalledWith(
      2,
      {
        kind: "repository",
        enqueueGoogleReconciliationRecovery: mocks.enqueueGoogleReconciliationRecovery,
      },
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
      recovery: { scanned: 3, jobsEnqueued: 2 },
      watchMaintenance: { scanned: 2, created: 1, renewed: 1, active: 2, failed: 0 },
      reconciliation: {
        claimed: 2,
        reconciled: 1,
        unchanged: 0,
        missing: 0,
        conflicts: 0,
        corrected: 1,
        disconnected: 0,
        retried: 0,
        terminal: 0,
        leaseLost: 0,
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

  it("keeps later calendar drains running when watch maintenance fails", async () => {
    mocks.maintainWatches.mockRejectedValueOnce(
      new Error("provider rejected ari@example.com postgresql://secret"),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(request());
    const body: unknown = await response.json();

    expect(mocks.processGoogleCalendarReconciliations).toHaveBeenCalledTimes(1);
    expect(mocks.processGoogleCalendarSyncJobs).toHaveBeenCalledTimes(1);
    expect(mocks.processCalendarSyncJobs).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      ok: false,
      failedPhases: ["watch_maintenance"],
      watchMaintenance: { scanned: 0, created: 0, renewed: 0, active: 0, failed: 0 },
      google: { claimed: 1 },
      ics: { claimed: 2 },
    });
    expect(JSON.stringify(body)).not.toContain("ari@example.com");
    expect(JSON.stringify(body)).not.toContain("postgresql://secret");
    expect(error).toHaveBeenCalledWith("[cron] calendar phase failed: watch_maintenance");
  });

  it("continues the main ICS drain after a fallback drain fails", async () => {
    mocks.processCalendarSyncJobs.mockRejectedValueOnce(
      new Error("provider rejected ari@example.com postgresql://secret"),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(request());
    const body: unknown = await response.json();

    expect(mocks.processCalendarSyncJobs).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      ok: false,
      failedPhases: ["fallback_ics"],
      ics: { claimed: 2, completed: 1 },
    });
    expect(JSON.stringify(body)).not.toContain("ari@example.com");
    expect(JSON.stringify(body)).not.toContain("postgresql://secret");
    expect(error).toHaveBeenCalledWith("[cron] calendar phase failed: fallback_ics");
  });
});
