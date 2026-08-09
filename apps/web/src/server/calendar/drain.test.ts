import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendSessionCalendarEmail: vi.fn(),
  processCalendarSyncJobs: vi.fn(),
  processGoogleCalendarSyncJobs: vi.fn(),
  calendarDeliveryRepository: vi.fn(),
  createGoogleCalendarProvider: vi.fn(),
  createGoogleCalendarRepository: vi.fn(),
  createGoogleCalendarWorkerAccess: vi.fn(),
  isGoogleCalendarServerConfigured: vi.fn(),
  loadGoogleCalendarServerConfig: vi.fn(),
}));

vi.mock("~/server/email/send", () => ({
  sendSessionCalendarEmail: mocks.sendSessionCalendarEmail,
}));
vi.mock("./delivery", () => ({
  processCalendarSyncJobs: mocks.processCalendarSyncJobs,
}));
vi.mock("./google-delivery", () => ({
  processGoogleCalendarSyncJobs: mocks.processGoogleCalendarSyncJobs,
}));
vi.mock("./repository", () => ({
  calendarDeliveryRepository: mocks.calendarDeliveryRepository,
}));
vi.mock("~/server/google-calendar", () => ({
  createGoogleCalendarProvider: mocks.createGoogleCalendarProvider,
  createGoogleCalendarRepository: mocks.createGoogleCalendarRepository,
  createGoogleCalendarWorkerAccess: mocks.createGoogleCalendarWorkerAccess,
  isGoogleCalendarServerConfigured: mocks.isGoogleCalendarServerConfigured,
  loadGoogleCalendarServerConfig: mocks.loadGoogleCalendarServerConfig,
}));

import { deliverCalendarSyncJobBestEffort } from "./drain";

describe("deliverCalendarSyncJobBestEffort", () => {
  beforeEach(() => {
    mocks.sendSessionCalendarEmail.mockReset();
    mocks.processCalendarSyncJobs.mockReset().mockResolvedValue({});
    mocks.processGoogleCalendarSyncJobs.mockReset().mockResolvedValue({
      claimed: 1,
      completed: 1,
      retried: 0,
      terminal: 0,
      leaseLost: 0,
      fallbackEnqueued: 0,
      fallbackJobIds: [],
    });
    mocks.calendarDeliveryRepository.mockReset().mockReturnValue({ kind: "repository" });
    mocks.createGoogleCalendarProvider.mockReset().mockReturnValue({ kind: "provider" });
    mocks.createGoogleCalendarRepository.mockReset().mockReturnValue({ kind: "google-repository" });
    mocks.createGoogleCalendarWorkerAccess.mockReset().mockReturnValue({ kind: "access" });
    mocks.isGoogleCalendarServerConfigured.mockReset().mockReturnValue(true);
    mocks.loadGoogleCalendarServerConfig.mockReset().mockReturnValue({ kind: "config" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when the transaction did not enqueue a calendar job", async () => {
    await expect(deliverCalendarSyncJobBestEffort({ kind: "db" } as never, null)).resolves.toBe(
      undefined,
    );
    expect(mocks.calendarDeliveryRepository).not.toHaveBeenCalled();
  });

  it("drains only the committed job", async () => {
    const db = { kind: "db" } as never;

    await deliverCalendarSyncJobBestEffort(db, "00000000-0000-4000-8000-000000000001");

    expect(mocks.calendarDeliveryRepository).toHaveBeenCalledWith(db);
    expect(mocks.processGoogleCalendarSyncJobs).toHaveBeenCalledWith(
      {
        repository: { kind: "repository" },
        provider: { kind: "provider" },
        access: { kind: "access" },
      },
      { jobId: "00000000-0000-4000-8000-000000000001", limit: 1 },
    );
    expect(mocks.processCalendarSyncJobs).toHaveBeenCalledWith(
      { kind: "repository" },
      mocks.sendSessionCalendarEmail,
      { jobId: "00000000-0000-4000-8000-000000000001", limit: 1 },
    );
  });

  it("immediately drains an ICS fallback created by the Google attempt", async () => {
    mocks.processGoogleCalendarSyncJobs.mockResolvedValueOnce({
      claimed: 1,
      completed: 0,
      retried: 1,
      terminal: 0,
      leaseLost: 0,
      fallbackEnqueued: 1,
      fallbackJobIds: ["00000000-0000-4000-8000-000000000002"],
    });

    await deliverCalendarSyncJobBestEffort(
      { kind: "db" } as never,
      "00000000-0000-4000-8000-000000000001",
    );

    expect(mocks.processCalendarSyncJobs).toHaveBeenNthCalledWith(
      1,
      { kind: "repository" },
      mocks.sendSessionCalendarEmail,
      { jobId: "00000000-0000-4000-8000-000000000001", limit: 1 },
    );
    expect(mocks.processCalendarSyncJobs).toHaveBeenNthCalledWith(
      2,
      { kind: "repository" },
      mocks.sendSessionCalendarEmail,
      { jobId: "00000000-0000-4000-8000-000000000002", limit: 1 },
    );
  });

  it("leaves a failed delivery for the scheduled worker without logging details", async () => {
    mocks.processCalendarSyncJobs.mockRejectedValueOnce(
      new Error("ari@example.com postgresql://secret"),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      deliverCalendarSyncJobBestEffort(
        { kind: "db" } as never,
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("[calendar] immediate invitation delivery failed");
  });
});
