import { describe, expect, it, vi } from "vitest";

import type { GoogleCalendarPreparedLink } from "../calendar/google-delivery";
import { createGoogleCalendarLinkedEventReader } from "./linked-event-reader";
import { GoogleCalendarProviderError, type GoogleCalendarProvider } from "./provider";
import type { GoogleCalendarRepository } from "./repository";

const mocks = vi.hoisted(() => ({ access: vi.fn() }));

vi.mock("./worker-access", () => ({
  createGoogleCalendarWorkerAccess: () => mocks.access,
}));

const LINK = {
  id: "11111111-1111-4111-8111-111111111111",
  producerId: "22222222-2222-4222-8222-222222222222",
  connectionId: "33333333-3333-4333-8333-333333333333",
  accountVersion: 1,
  destinationSelectionId: "44444444-4444-4444-8444-444444444444",
  destinationCalendarIdCiphertext: "ciphertext",
  destinationCalendarIdIv: "iv",
  destinationCalendarIdAuthTag: "tag",
  destinationCalendarIdKeyVersion: 1,
  providerEventId: "sk11111111111141118111111111111111",
  providerEventEtag: '"etag-1"',
  providerState: "active",
  syncState: "synced",
  desiredRevision: 1,
  lastGoogleRevision: 1,
  invitationRevision: 1,
  invitationChannel: "google",
  invitationReservedAt: null,
  invitationAttemptedAt: null,
  invitationDeliveredAt: null,
} satisfies GoogleCalendarPreparedLink;

function readerWith(provider: GoogleCalendarProvider) {
  return createGoogleCalendarLinkedEventReader({
    repository: {} as GoogleCalendarRepository,
    provider,
    config: {} as never,
  });
}

describe("Google Calendar linked event reader", () => {
  it("keeps credentials and raw calendar IDs behind the narrow facade", async () => {
    const getLinkedEvent = vi.fn<GoogleCalendarProvider["getLinkedEvent"]>().mockResolvedValue({
      outcome: "not_modified",
    });
    const markReconnectRequired = vi.fn().mockResolvedValue(undefined);
    mocks.access.mockResolvedValue({
      status: "ready",
      accessToken: "private-access-token",
      calendarId: "private-calendar-id",
      markReconnectRequired,
    });
    const result = await readerWith({ getLinkedEvent } as unknown as GoogleCalendarProvider)(LINK, {
      artistEmail: "artist@example.com",
      ifNoneMatch: '"etag-1"',
    });
    expect(getLinkedEvent).toHaveBeenCalledWith("private-access-token", {
      calendarId: "private-calendar-id",
      eventId: LINK.providerEventId,
      artistEmail: "artist@example.com",
      ifNoneMatch: '"etag-1"',
    });
    expect(result).toEqual({ status: "ready", lookup: { outcome: "not_modified" } });
    expect(JSON.stringify(result)).not.toContain("private-access-token");
    expect(JSON.stringify(result)).not.toContain("private-calendar-id");
  });

  it("does no provider read when connection access is unavailable", async () => {
    const getLinkedEvent = vi.fn<GoogleCalendarProvider["getLinkedEvent"]>();
    mocks.access.mockResolvedValue({ status: "disconnected" });
    await expect(
      readerWith({ getLinkedEvent } as unknown as GoogleCalendarProvider)(LINK, {
        artistEmail: "artist@example.com",
      }),
    ).resolves.toEqual({ status: "disconnected" });
    expect(getLinkedEvent).not.toHaveBeenCalled();
  });

  it("marks revoked event access for reconnect without exposing the provider failure", async () => {
    const markReconnectRequired = vi.fn().mockResolvedValue(undefined);
    mocks.access.mockResolvedValue({
      status: "ready",
      accessToken: "private-access-token",
      calendarId: "private-calendar-id",
      markReconnectRequired,
    });
    const getLinkedEvent = vi
      .fn<GoogleCalendarProvider["getLinkedEvent"]>()
      .mockRejectedValue(new GoogleCalendarProviderError("access_unauthorized"));
    await expect(
      readerWith({ getLinkedEvent } as unknown as GoogleCalendarProvider)(LINK, {
        artistEmail: "artist@example.com",
      }),
    ).resolves.toEqual({ status: "reconnect_required" });
    expect(markReconnectRequired).toHaveBeenCalledOnce();
  });
});
