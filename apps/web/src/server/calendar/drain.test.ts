import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendSessionCalendarEmail: vi.fn(),
  processCalendarSyncJobs: vi.fn(),
  calendarDeliveryRepository: vi.fn(),
}));

vi.mock("~/server/email/send", () => ({
  sendSessionCalendarEmail: mocks.sendSessionCalendarEmail,
}));
vi.mock("./delivery", () => ({
  processCalendarSyncJobs: mocks.processCalendarSyncJobs,
}));
vi.mock("./repository", () => ({
  calendarDeliveryRepository: mocks.calendarDeliveryRepository,
}));

import { deliverCalendarSyncJobBestEffort } from "./drain";

describe("deliverCalendarSyncJobBestEffort", () => {
  beforeEach(() => {
    mocks.sendSessionCalendarEmail.mockReset();
    mocks.processCalendarSyncJobs.mockReset().mockResolvedValue({});
    mocks.calendarDeliveryRepository.mockReset().mockReturnValue({ kind: "repository" });
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
    expect(mocks.processCalendarSyncJobs).toHaveBeenCalledWith(
      { kind: "repository" },
      mocks.sendSessionCalendarEmail,
      { jobId: "00000000-0000-4000-8000-000000000001", limit: 1 },
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
