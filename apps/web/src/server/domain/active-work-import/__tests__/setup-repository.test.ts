import type { Db } from "@skitza/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deliver: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("../../client-invitations/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client-invitations/service")>();
  return {
    ...actual,
    deliverClientInvitation: (...args: unknown[]) => mocks.deliver(...args),
  };
});

vi.mock("../../client-invitations/db", () => ({
  clientInvitationDeliveryRepository: () => ({ kind: "delivery-repository" }),
  loadCurrentClientInvitationStates: vi.fn(),
  reserveActiveWorkImportClientInvitationEmail: vi.fn(),
}));

import { EmailDeliveryError } from "~/server/email/delivery-error";
import {
  ClientInvitationDomainError,
  type ClientInvitationDeliveryRecord,
} from "../../client-invitations/service";
import { activeWorkImportSetupRepository } from "../setup";

const NOW = new Date("2026-08-20T12:00:00.000Z");

function delivery(): ClientInvitationDeliveryRecord {
  return {
    id: "delivery-client-a",
    clientContactId: "client-a",
    producerId: "producer-1",
    operationKey: "active-work-import-invite:1",
    operationDigest: `sha256:${"a".repeat(64)}`,
    recipientEmail: "a@example.com",
    recipientEmailHash: "b".repeat(64),
    messageSnapshot: {
      to: "a@example.com",
      artistName: "Artist A",
      producerName: "Producer",
      inviteUrl: "https://example.com/join",
    },
    requestedByClerkUserId: "user-1",
    providerIdempotencyKey: "provider-client-a",
    status: "reserved",
    claimToken: null,
    claimUntil: null,
    attemptCount: 0,
    firstAttemptAt: null,
    lastAttemptAt: null,
    providerDedupeExpiresAt: null,
    providerMessageId: null,
    providerAcceptedAt: null,
    lastFailedAt: null,
    failureCode: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("active work import setup repository delivery", () => {
  const repository = activeWorkImportSetupRepository({} as Db, () => Promise.resolve("id"));
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    consoleError.mockRestore();
  });

  it("turns provider rejections into failed results with a plain reason", async () => {
    const rejected = new EmailDeliveryError({
      name: "validation_error",
      message: "Invalid `to` field",
      statusCode: 422,
    });
    mocks.deliver.mockRejectedValueOnce(rejected);
    await expect(repository.deliverInvitation(delivery(), NOW)).resolves.toEqual({
      status: "failed",
      providerAcceptedAt: null,
      reason: "The email service rejected this client's email address.",
    });
    expect(consoleError).toHaveBeenCalledWith("[active-work-import] invitation delivery failed", {
      clientContactId: "client-a",
      deliveryId: "delivery-client-a",
      error: rejected,
    });

    mocks.deliver.mockRejectedValueOnce(
      new EmailDeliveryError({
        name: "rate_limit_exceeded",
        message: "slow down",
        statusCode: 429,
      }),
    );
    await expect(repository.deliverInvitation(delivery(), NOW)).resolves.toMatchObject({
      status: "failed",
      reason: "The email service is busy. Try again in a few minutes.",
    });

    mocks.deliver.mockRejectedValueOnce(
      new ClientInvitationDomainError("CONFLICT", "Invitation claim is no longer owned"),
    );
    await expect(repository.deliverInvitation(delivery(), NOW)).resolves.toMatchObject({
      status: "failed",
      reason: "Invitation claim is no longer owned",
    });
  });

  it("names a misconfigured email service instead of failing the whole setup", async () => {
    mocks.deliver.mockRejectedValueOnce(
      new EmailDeliveryError({
        name: "configuration_error",
        message: "RESEND_API_KEY contains characters that cannot be sent in a request header",
        statusCode: null,
      }),
    );
    await expect(repository.deliverInvitation(delivery(), NOW)).resolves.toEqual({
      status: "failed",
      providerAcceptedAt: null,
      reason:
        "The email service is not set up yet, so this invitation was not sent. Finish setup without it; you can invite this client later from Clients & Projects.",
    });
  });

  it("reports a busy or expired provider operation honestly", async () => {
    mocks.deliver.mockResolvedValueOnce({ state: "sending" });
    await expect(repository.deliverInvitation(delivery(), NOW)).resolves.toEqual({
      status: "requested",
      providerAcceptedAt: null,
    });

    mocks.deliver.mockResolvedValueOnce({ state: "dedupe_expired" });
    await expect(repository.deliverInvitation(delivery(), NOW)).resolves.toEqual({
      status: "failed",
      providerAcceptedAt: null,
      reason: "The earlier send attempt expired. Try again.",
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("rethrows unexpected failures after logging them", async () => {
    const failure = new TypeError("Cannot read properties of undefined (reading 'to')");
    mocks.deliver.mockRejectedValueOnce(failure);

    await expect(repository.deliverInvitation(delivery(), NOW)).rejects.toBe(failure);
    expect(consoleError).toHaveBeenCalledWith("[active-work-import] invitation delivery failed", {
      clientContactId: "client-a",
      deliveryId: "delivery-client-a",
      error: failure,
    });
  });
});
