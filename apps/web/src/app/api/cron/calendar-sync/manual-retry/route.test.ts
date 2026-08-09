import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDb: vi.fn(),
  calendarManualRetryRepository: vi.fn(),
  manualRetryCalendarSyncJob: vi.fn(),
}));

vi.mock("@skitza/db", () => ({ createDb: mocks.createDb }));
vi.mock("~/server/calendar/manual-retry", async (importOriginal) => {
  const original = await importOriginal<typeof import("~/server/calendar/manual-retry")>();
  return {
    ...original,
    calendarManualRetryRepository: mocks.calendarManualRetryRepository,
    manualRetryCalendarSyncJob: mocks.manualRetryCalendarSyncJob,
  };
});

import { CalendarManualRetryError } from "~/server/calendar/manual-retry";
import { POST } from "./route";

const body = {
  jobId: "00000000-0000-4000-8000-000000000001",
  producerId: "00000000-0000-4000-8000-000000000002",
  operationKey: "calendar-manual-retry-1",
  actorIdentity: "operator:gili",
};

function request(
  overrides: {
    secret?: string;
    body?: unknown;
    rawBody?: string;
  } = {},
) {
  return new Request("https://skitza.test/api/cron/calendar-sync/manual-retry", {
    method: "POST",
    headers: {
      authorization: `Bearer ${overrides.secret ?? "cron-test-secret"}`,
      "content-type": "application/json",
    },
    body: overrides.rawBody ?? JSON.stringify(overrides.body ?? body),
  });
}

describe("POST /api/cron/calendar-sync/manual-retry", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/skitza");
    mocks.createDb.mockReset().mockReturnValue({ kind: "db" });
    mocks.calendarManualRetryRepository.mockReset().mockReturnValue({ kind: "repository" });
    mocks.manualRetryCalendarSyncJob.mockReset().mockResolvedValue({
      jobId: body.jobId,
      producerId: body.producerId,
      retryNumber: 1,
      replayed: false,
      status: "pending",
      idempotencyKey: "internal-provider-key",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("requires the operator secret and database environment", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(request())).status).toBe(503);

    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    expect((await POST(request({ secret: "wrong" }))).status).toBe(401);

    vi.stubEnv("DATABASE_URL", "");
    expect((await POST(request())).status).toBe(503);
    expect(mocks.createDb).not.toHaveBeenCalled();
  });

  it("rejects malformed or incomplete audit identity", async () => {
    const malformed = await POST(request({ rawBody: "{" }));
    expect(malformed.status).toBe(400);

    const missingActor = await POST(request({ body: { ...body, actorIdentity: "" } }));
    expect(missingActor.status).toBe(400);
    expect(mocks.manualRetryCalendarSyncJob).not.toHaveBeenCalled();
  });

  it("targets the exact job and tenant without exposing the provider key", async () => {
    const response = await POST(request());

    expect(mocks.createDb).toHaveBeenCalledWith("postgresql://test.invalid/skitza");
    expect(mocks.calendarManualRetryRepository).toHaveBeenCalledWith({ kind: "db" });
    expect(mocks.manualRetryCalendarSyncJob).toHaveBeenCalledWith({ kind: "repository" }, body);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      jobId: body.jobId,
      producerId: body.producerId,
      retryNumber: 1,
      replayed: false,
      status: "pending",
    });
  });

  it("maps exact-target and replay conflicts without leaking error details", async () => {
    mocks.manualRetryCalendarSyncJob.mockRejectedValueOnce(
      new CalendarManualRetryError("NOT_FOUND", "secret job detail"),
    );
    const missing = await POST(request());
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ ok: false, reason: "not found" });

    mocks.manualRetryCalendarSyncJob.mockRejectedValueOnce(
      new CalendarManualRetryError("OPERATION_KEY_CONFLICT", "secret operation detail"),
    );
    const conflict = await POST(request());
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({ ok: false, reason: "retry conflict" });
  });

  it("returns only a generic unexpected failure", async () => {
    mocks.manualRetryCalendarSyncJob.mockRejectedValueOnce(
      new Error("ari@example.com postgresql://secret"),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      reason: "calendar retry failed",
    });
    expect(error).toHaveBeenCalledWith("[cron] calendar manual retry failed");
  });
});
