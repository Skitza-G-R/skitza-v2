import { describe, expect, it, vi } from "vitest";

import type { GoogleCalendarWebhookRepository } from "./webhook-repository";
import { acceptGoogleCalendarWebhook } from "./webhook";
import {
  createGoogleCalendarWatchCredentials,
  digestGoogleCalendarWatchToken,
  parseGoogleCalendarWebhookHeaders,
} from "./watch";

const HEADERS = {
  "x-goog-channel-id": "11111111-1111-4111-8111-111111111111",
  "x-goog-resource-id": "opaque-resource-id",
  "x-goog-channel-token": "private-channel-token",
  "x-goog-message-number": "42",
  "x-goog-resource-state": "exists",
} as const;

describe("Google Calendar watch trust boundary", () => {
  it("creates an opaque channel with only a digest suitable for storage", () => {
    const credentials = createGoogleCalendarWatchCredentials();
    expect(credentials.channelId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(credentials.channelToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(credentials.channelTokenDigest).toBe(
      digestGoogleCalendarWatchToken(credentials.channelToken),
    );
    expect(credentials.channelTokenDigest).not.toContain(credentials.channelToken);
  });

  it("accepts only documented bounded headers and immediately drops the raw token", () => {
    const parsed = parseGoogleCalendarWebhookHeaders(new Headers(HEADERS));
    expect(parsed).toEqual({
      channelId: HEADERS["x-goog-channel-id"],
      resourceId: HEADERS["x-goog-resource-id"],
      channelTokenDigest: digestGoogleCalendarWatchToken(HEADERS["x-goog-channel-token"]),
      messageNumber: "42",
      resourceState: "exists",
    });
    expect(JSON.stringify(parsed)).not.toContain(HEADERS["x-goog-channel-token"]);
  });

  it("rejects incomplete, malformed, and non-monotonic-shaped messages before repository work", async () => {
    const enqueueVerifiedNotification =
      vi.fn<GoogleCalendarWebhookRepository["enqueueVerifiedNotification"]>();
    const repository = { enqueueVerifiedNotification };

    for (const overrides of [
      { "x-goog-channel-token": "" },
      { "x-goog-channel-id": "not-a-channel" },
      { "x-goog-message-number": "0" },
      { "x-goog-message-number": "1".repeat(40) },
      { "x-goog-resource-state": "update" },
    ]) {
      const headers = new Headers({ ...HEADERS, ...overrides });
      await expect(acceptGoogleCalendarWebhook({ headers, repository })).resolves.toEqual({
        outcome: "invalid",
        jobsEnqueued: 0,
        jobIds: [],
      });
    }
    expect(enqueueVerifiedNotification).not.toHaveBeenCalled();
  });

  it("passes only verified header facts and receipt time to the atomic repository", async () => {
    const receivedAt = new Date("2026-08-09T12:00:00.000Z");
    const enqueueVerifiedNotification = vi
      .fn<GoogleCalendarWebhookRepository["enqueueVerifiedNotification"]>()
      .mockResolvedValue({ outcome: "accepted", jobsEnqueued: 1, jobIds: ["job-id"] });
    const result = await acceptGoogleCalendarWebhook({
      headers: new Headers(HEADERS),
      repository: { enqueueVerifiedNotification },
      receivedAt,
    });
    expect(result).toEqual({ outcome: "accepted", jobsEnqueued: 1, jobIds: ["job-id"] });
    expect(enqueueVerifiedNotification).toHaveBeenCalledWith({
      channelId: HEADERS["x-goog-channel-id"],
      resourceId: HEADERS["x-goog-resource-id"],
      channelTokenDigest: digestGoogleCalendarWatchToken(HEADERS["x-goog-channel-token"]),
      messageNumber: "42",
      resourceState: "exists",
      receivedAt,
    });
  });
});
