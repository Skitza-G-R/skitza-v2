import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDb: vi.fn(),
  configured: vi.fn(),
  createRepository: vi.fn(),
  acceptWebhook: vi.fn(),
  after: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("@skitza/db", () => ({ createDb: mocks.createDb }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("~/server/calendar/drain", () => ({
  reconcileGoogleCalendarBestEffort: mocks.reconcile,
}));
vi.mock("~/server/google-calendar", () => ({
  isGoogleCalendarServerConfigured: mocks.configured,
  createGoogleCalendarWebhookRepository: mocks.createRepository,
  acceptGoogleCalendarWebhook: mocks.acceptWebhook,
}));

import { POST } from "./route";

const HEADERS = new Headers({
  "x-goog-channel-id": "11111111-1111-4111-8111-111111111111",
  "x-goog-resource-id": "opaque-resource-id",
  "x-goog-channel-token": "private-channel-token",
  "x-goog-message-number": "42",
  "x-goog-resource-state": "exists",
});

describe("Google Calendar webhook route", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/skitza");
    mocks.createDb.mockReset().mockReturnValue({ kind: "db" });
    mocks.configured.mockReset().mockReturnValue(true);
    mocks.createRepository.mockReset().mockReturnValue({ kind: "repository" });
    mocks.acceptWebhook.mockReset().mockResolvedValue({
      outcome: "accepted",
      jobsEnqueued: 1,
      jobIds: ["job-id"],
    });
    mocks.after.mockReset();
    mocks.reconcile.mockReset().mockResolvedValue(undefined);
  });

  it("returns quickly with no body read and no provider details in the response", async () => {
    const request = { headers: HEADERS } as Request;
    const response = await POST(request);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(mocks.createDb).toHaveBeenCalledWith("postgresql://test.invalid/skitza");
    expect(mocks.acceptWebhook).toHaveBeenCalledWith({
      headers: HEADERS,
      repository: { kind: "repository" },
    });
    expect(mocks.after).toHaveBeenCalledOnce();
    const wake = mocks.after.mock.calls[0]?.[0] as (() => Promise<void>) | undefined;
    await wake?.();
    expect(mocks.reconcile).toHaveBeenCalledWith({ kind: "db" });
  });

  it("does no work while the capability gate is closed", async () => {
    mocks.configured.mockReturnValue(false);
    const response = await POST({ headers: HEADERS } as Request);
    expect(response.status).toBe(204);
    expect(mocks.createDb).not.toHaveBeenCalled();
    expect(mocks.acceptWebhook).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("returns a retryable generic failure without leaking provider data", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.acceptWebhook.mockRejectedValue(new Error("private-channel-token"));
    const response = await POST({ headers: HEADERS } as Request);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expect(errorSpy).toHaveBeenCalledWith("[google-calendar] webhook enqueue failed");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("private-channel-token");
    errorSpy.mockRestore();
  });
});
