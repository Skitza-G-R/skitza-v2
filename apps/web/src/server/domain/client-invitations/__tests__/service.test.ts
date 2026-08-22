import { describe, expect, it, vi } from "vitest";

import {
  activeWorkImportInvitationGate,
  clientInvitationPresentationState,
  deliverClientInvitation,
  hasActiveClientConnection,
  providerAcceptedAtForCurrentEmail,
  producerClientInvitationPresentationState,
  resumableNormalClientInvitation,
  type ClientInvitationClaimResult,
  type ClientInvitationDeliveryRecord,
  type ClientInvitationDeliveryRepository,
  type SendClientInvitation,
} from "../service";

const ATTEMPTED_AT = new Date("2026-08-20T12:00:00.000Z");
const COMPLETED_AT = new Date("2026-08-20T12:01:00.000Z");

function delivery(): ClientInvitationDeliveryRecord {
  return {
    id: "delivery-1",
    clientContactId: "client-1",
    producerId: "producer-1",
    operationKey: "invite-click-1",
    operationDigest: `sha256:${"a".repeat(64)}`,
    recipientEmail: "artist@example.com",
    recipientEmailHash: "b".repeat(64),
    messageSnapshot: {
      to: "artist@example.com",
      artistName: "Artist",
      producerName: "Producer",
      inviteUrl: "https://skitza.app/sign-up/join/producer/home",
    },
    requestedByClerkUserId: "clerk-producer",
    providerIdempotencyKey: "client-invite:client-1:stable-operation",
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
    createdAt: ATTEMPTED_AT,
    updatedAt: ATTEMPTED_AT,
  };
}

class MemoryRepository implements ClientInvitationDeliveryRepository {
  current = delivery();

  claimDelivery(input: Parameters<ClientInvitationDeliveryRepository["claimDelivery"]>[0]) {
    const row = this.current;
    if (row.status === "provider_accepted") {
      return Promise.resolve({ state: "provider_accepted", delivery: row } as const);
    }
    if (row.status === "dedupe_expired") {
      return Promise.resolve({ state: "dedupe_expired" } as const);
    }
    if (
      row.status === "sending" &&
      row.claimUntil &&
      row.claimUntil.getTime() > input.claimedAt.getTime()
    ) {
      return Promise.resolve({ state: "busy" } as const);
    }
    const dedupe = row.providerDedupeExpiresAt ?? input.newProviderDedupeExpiresAt;
    if (row.firstAttemptAt && input.claimedAt.getTime() >= dedupe.getTime()) {
      this.current = {
        ...row,
        status: "dedupe_expired",
        claimToken: null,
        claimUntil: null,
        updatedAt: input.claimedAt,
      };
      return Promise.resolve({ state: "dedupe_expired" } as const);
    }
    this.current = {
      ...row,
      status: "sending",
      claimToken: input.claimToken,
      claimUntil: input.claimUntil,
      attemptCount: row.attemptCount + 1,
      firstAttemptAt: row.firstAttemptAt ?? input.claimedAt,
      lastAttemptAt: input.claimedAt,
      providerDedupeExpiresAt: dedupe,
      failureCode: null,
      updatedAt: input.claimedAt,
    };
    return Promise.resolve({
      state: "claimed",
      delivery: this.current,
      claimToken: input.claimToken,
    } satisfies ClientInvitationClaimResult);
  }

  completeDelivery(input: Parameters<ClientInvitationDeliveryRepository["completeDelivery"]>[0]) {
    if (this.current.status === "provider_accepted") {
      return Promise.resolve({ delivery: this.current, created: false });
    }
    if (this.current.status !== "sending" || this.current.claimToken !== input.claimToken) {
      throw new Error("claim lost");
    }
    this.current = {
      ...this.current,
      status: "provider_accepted",
      claimToken: null,
      claimUntil: null,
      providerMessageId: input.providerMessageId,
      providerAcceptedAt: input.providerAcceptedAt,
      updatedAt: input.providerAcceptedAt,
    };
    return Promise.resolve({ delivery: this.current, created: true });
  }

  failDelivery(input: Parameters<ClientInvitationDeliveryRepository["failDelivery"]>[0]) {
    if (this.current.status === "sending" && this.current.claimToken === input.claimToken) {
      this.current = {
        ...this.current,
        status: "failed",
        claimToken: null,
        claimUntil: null,
        lastFailedAt: input.failedAt,
        failureCode: input.failureCode,
        updatedAt: input.failedAt,
      };
    }
    return Promise.resolve();
  }
}

describe("client invitation provider delivery", () => {
  it("presents durable current-email invitation truth without legacy link intent", () => {
    expect(hasActiveClientConnection("artist-clerk", null)).toBe(true);
    expect(hasActiveClientConnection("artist-clerk", COMPLETED_AT)).toBe(false);
    expect(hasActiveClientConnection(null, null)).toBe(false);
    expect(clientInvitationPresentationState([])).toBe("available");
    expect(
      clientInvitationPresentationState([{ status: "reserved", providerAcceptedAt: null }]),
    ).toBe("requested");
    expect(
      clientInvitationPresentationState([{ status: "sending", providerAcceptedAt: null }]),
    ).toBe("requested");
    expect(
      clientInvitationPresentationState([{ status: "failed", providerAcceptedAt: null }]),
    ).toBe("failed");
    expect(
      clientInvitationPresentationState([{ status: "dedupe_expired", providerAcceptedAt: null }]),
    ).toBe("failed");
    expect(
      clientInvitationPresentationState([
        { status: "failed", providerAcceptedAt: null },
        { status: "provider_accepted", providerAcceptedAt: COMPLETED_AT },
      ]),
    ).toBe("provider_accepted");
    expect(producerClientInvitationPresentationState("artist-clerk", "failed")).toBe("connected");
    expect(
      producerClientInvitationPresentationState(
        "disconnected-artist-clerk",
        "available",
        COMPLETED_AT,
      ),
    ).toBe("available");
  });

  it("durably resumes a normal invite after reload without changing its provider key", () => {
    const reserved = delivery();
    const sending = {
      ...delivery(),
      status: "sending" as const,
      claimToken: "old-claim",
      claimUntil: new Date(ATTEMPTED_AT.getTime() - 1),
      attemptCount: 1,
      firstAttemptAt: ATTEMPTED_AT,
      providerDedupeExpiresAt: new Date(ATTEMPTED_AT.getTime() + 86_400_000),
    };
    const failed = {
      ...sending,
      status: "failed" as const,
      claimToken: null,
      claimUntil: null,
    };

    for (const durable of [reserved, sending, failed]) {
      const recovered = resumableNormalClientInvitation(
        [durable],
        new Date(ATTEMPTED_AT.getTime() + 60_000),
      );
      expect(recovered).toBe(durable);
      expect(recovered?.providerIdempotencyKey).toBe("client-invite:client-1:stable-operation");
    }
  });

  it("does not reuse accepted or dedupe-expired delivery identities", () => {
    const accepted = {
      ...delivery(),
      status: "provider_accepted" as const,
      providerAcceptedAt: COMPLETED_AT,
    };
    const expired = { ...delivery(), status: "dedupe_expired" as const };
    const failedPastDedupe = {
      ...delivery(),
      status: "failed" as const,
      attemptCount: 1,
      providerDedupeExpiresAt: ATTEMPTED_AT,
    };
    const sendingPastDedupe = {
      ...failedPastDedupe,
      status: "sending" as const,
      claimToken: "expired-claim",
    };
    expect(
      resumableNormalClientInvitation(
        [accepted, expired, failedPastDedupe, sendingPastDedupe],
        new Date(ATTEMPTED_AT.getTime() + 1),
      ),
    ).toBeNull();
  });

  it("does not revive a failed row older than current-email provider acceptance", () => {
    const olderFailure = {
      ...delivery(),
      status: "failed" as const,
      attemptCount: 1,
      providerDedupeExpiresAt: new Date(COMPLETED_AT.getTime() + 86_400_000),
    };
    const accepted = {
      ...delivery(),
      id: "accepted-delivery",
      operationKey: "accepted-operation",
      status: "provider_accepted" as const,
      providerAcceptedAt: COMPLETED_AT,
      updatedAt: COMPLETED_AT,
    };
    expect(
      resumableNormalClientInvitation(
        [olderFailure, accepted],
        new Date(COMPLETED_AT.getTime() + 60_000),
      ),
    ).toBeNull();

    const laterDeliberateFailure = {
      ...olderFailure,
      id: "later-failure",
      operationKey: "later-deliberate-operation",
      createdAt: new Date(COMPLETED_AT.getTime() + 1),
      updatedAt: new Date(COMPLETED_AT.getTime() + 1),
    };
    expect(
      resumableNormalClientInvitation(
        [laterDeliberateFailure, accepted],
        new Date(COMPLETED_AT.getTime() + 60_000),
      ),
    ).toBe(laterDeliberateFailure);
  });

  it("records provider acceptance after the network response with one stable provider key", async () => {
    const repository = new MemoryRepository();
    const send = vi.fn().mockResolvedValue("resend-message-1");
    const outcome = await deliverClientInvitation(
      repository,
      send,
      repository.current,
      ATTEMPTED_AT,
      () => COMPLETED_AT,
    );

    expect(outcome).toMatchObject({ state: "provider_accepted", created: true });
    expect(send).toHaveBeenCalledWith({
      message: repository.current.messageSnapshot,
      idempotencyKey: "client-invite:client-1:stable-operation",
    });
    expect(repository.current).toMatchObject({
      status: "provider_accepted",
      attemptCount: 1,
      firstAttemptAt: ATTEMPTED_AT,
      lastAttemptAt: ATTEMPTED_AT,
      providerAcceptedAt: COMPLETED_AT,
      providerMessageId: "resend-message-1",
    });
    expect(repository.current.providerDedupeExpiresAt).toEqual(
      new Date(ATTEMPTED_AT.getTime() + 24 * 60 * 60 * 1_000),
    );
  });

  it("does not send twice when the same click is retried while its claim is active", async () => {
    const repository = new MemoryRepository();
    let release: (id: string) => void = () => undefined;
    const send = vi.fn<SendClientInvitation>(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const first = deliverClientInvitation(
      repository,
      send,
      repository.current,
      ATTEMPTED_AT,
      () => COMPLETED_AT,
    );
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    const retry = await deliverClientInvitation(
      repository,
      send,
      delivery(),
      new Date(ATTEMPTED_AT.getTime() + 1_000),
      () => COMPLETED_AT,
    );
    expect(retry).toEqual({ state: "sending" });
    expect(send).toHaveBeenCalledTimes(1);
    release("resend-message-1");
    await expect(first).resolves.toMatchObject({ state: "provider_accepted" });
  });

  it("retries a provider failure with the exact same key inside the 24-hour window", async () => {
    const repository = new MemoryRepository();
    const send = vi
      .fn<SendClientInvitation>()
      .mockRejectedValueOnce(new Error("temporary provider error"))
      .mockResolvedValueOnce("resend-message-1");
    await expect(
      deliverClientInvitation(
        repository,
        send,
        repository.current,
        ATTEMPTED_AT,
        () => COMPLETED_AT,
      ),
    ).rejects.toThrow("temporary provider error");
    expect(repository.current).toMatchObject({ status: "failed", attemptCount: 1 });

    await expect(
      deliverClientInvitation(
        repository,
        send,
        delivery(),
        new Date(ATTEMPTED_AT.getTime() + 60_000),
        () => COMPLETED_AT,
      ),
    ).resolves.toMatchObject({ state: "provider_accepted" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(new Set(send.mock.calls.map((call) => call[0].idempotencyKey))).toEqual(
      new Set(["client-invite:client-1:stable-operation"]),
    );
    expect(repository.current.attemptCount).toBe(2);
  });

  it("records a delayed provider failure when the attempt actually finishes", async () => {
    const repository = new MemoryRepository();
    const failedAt = new Date("2026-08-20T12:03:00.000Z");
    const send = vi.fn().mockRejectedValue(new Error("delayed provider failure"));

    await expect(
      deliverClientInvitation(repository, send, repository.current, ATTEMPTED_AT, () => failedAt),
    ).rejects.toThrow("delayed provider failure");

    expect(repository.current).toMatchObject({
      status: "failed",
      firstAttemptAt: ATTEMPTED_AT,
      lastAttemptAt: ATTEMPTED_AT,
      lastFailedAt: failedAt,
      updatedAt: failedAt,
    });
  });

  it("persists the real failure reason, including provider detail, instead of the error name", async () => {
    const repository = new MemoryRepository();
    const providerFailure = new Error("Email delivery failed: validation_error (422)", {
      cause: { name: "validation_error", message: "Invalid `to` field", statusCode: 422 },
    });
    providerFailure.name = "EmailDeliveryError";
    const send = vi.fn().mockRejectedValue(providerFailure);

    await expect(
      deliverClientInvitation(repository, send, repository.current, ATTEMPTED_AT, () => COMPLETED_AT),
    ).rejects.toBe(providerFailure);

    expect(repository.current).toMatchObject({
      status: "failed",
      failureCode:
        "EmailDeliveryError: Email delivery failed: validation_error (422) — Invalid `to` field",
    });

    const plain = new MemoryRepository();
    await expect(
      deliverClientInvitation(
        plain,
        vi.fn().mockRejectedValue(new TypeError("fetch failed")),
        plain.current,
        ATTEMPTED_AT,
        () => COMPLETED_AT,
      ),
    ).rejects.toThrow("fetch failed");
    expect(plain.current.failureCode).toBe("TypeError: fetch failed");
  });

  it("logs a failure-marking problem instead of hiding it behind the provider error", async () => {
    const repository = new MemoryRepository();
    const markingFailure = new Error("claim row changed");
    repository.failDelivery = () => Promise.reject(markingFailure);
    const send = vi.fn().mockRejectedValue(new Error("temporary provider error"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(
        deliverClientInvitation(
          repository,
          send,
          repository.current,
          ATTEMPTED_AT,
          () => COMPLETED_AT,
        ),
      ).rejects.toThrow("temporary provider error");
      expect(consoleError).toHaveBeenCalledWith(
        "[client-invitations] failure marking failed",
        { clientContactId: "client-1", deliveryId: "delivery-1", error: markingFailure },
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("expires the same provider operation instead of risking a duplicate after 24 hours", async () => {
    const repository = new MemoryRepository();
    const send = vi.fn().mockRejectedValueOnce(new Error("temporary provider error"));
    await expect(
      deliverClientInvitation(
        repository,
        send,
        repository.current,
        ATTEMPTED_AT,
        () => COMPLETED_AT,
      ),
    ).rejects.toThrow();
    const outcome = await deliverClientInvitation(
      repository,
      send,
      delivery(),
      new Date(ATTEMPTED_AT.getTime() + 24 * 60 * 60 * 1_000),
    );
    expect(outcome).toEqual({ state: "dedupe_expired" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("counts provider acceptance only for the Client's current email hash", () => {
    const oldAcceptedAt = new Date("2026-08-10T12:00:00.000Z");
    const currentAcceptedAt = new Date("2026-08-12T12:00:00.000Z");
    expect(
      providerAcceptedAtForCurrentEmail("current-hash", [
        {
          status: "provider_accepted",
          recipientEmailHash: "old-hash",
          providerAcceptedAt: oldAcceptedAt,
        },
      ]),
    ).toBeNull();
    expect(
      providerAcceptedAtForCurrentEmail("current-hash", [
        {
          status: "provider_accepted",
          recipientEmailHash: "old-hash",
          providerAcceptedAt: oldAcceptedAt,
        },
        {
          status: "provider_accepted",
          recipientEmailHash: "current-hash",
          providerAcceptedAt: currentAcceptedAt,
        },
      ]),
    ).toEqual(currentAcceptedAt);
  });

  it.each([
    { status: "reserved" as const, attemptCount: 0 },
    { status: "sending" as const, attemptCount: 1 },
    { status: "failed" as const, attemptCount: 1 },
    { status: "dedupe_expired" as const, attemptCount: 1 },
  ])("keeps an active-work current-email $status row eligible for locked recovery", (row) => {
    expect(
      activeWorkImportInvitationGate({
        connected: false,
        currentEmailValid: true,
        currentEmailHash: "current-hash",
        expectedEmailHash: "current-hash",
        operationKey: "bulk-derived-operation",
        deliveries: [
          {
            operationKey: "another-operation",
            status: row.status,
            attemptCount: row.attemptCount,
            providerAcceptedAt: null,
          },
        ],
      }),
    ).toEqual({ state: "eligible" });
  });

  it("allows exact-operation replay and returns provider-accepted or connected truth", () => {
    const exact = {
      operationKey: "bulk-derived-operation",
      status: "sending" as const,
      attemptCount: 1,
      providerAcceptedAt: null,
    };
    expect(
      activeWorkImportInvitationGate({
        connected: false,
        currentEmailValid: true,
        currentEmailHash: "current-hash",
        expectedEmailHash: "current-hash",
        operationKey: exact.operationKey,
        deliveries: [exact],
      }),
    ).toEqual({ state: "eligible" });
    expect(
      activeWorkImportInvitationGate({
        connected: false,
        currentEmailValid: true,
        currentEmailHash: "new-current-hash",
        expectedEmailHash: "reviewed-old-hash",
        operationKey: exact.operationKey,
        deliveries: [exact],
      }),
    ).toEqual({ state: "ineligible" });
    expect(
      activeWorkImportInvitationGate({
        connected: false,
        currentEmailValid: true,
        currentEmailHash: "current-hash",
        expectedEmailHash: "current-hash",
        operationKey: "new-operation",
        deliveries: [
          {
            operationKey: "accepted-operation",
            status: "provider_accepted",
            attemptCount: 1,
            providerAcceptedAt: COMPLETED_AT,
          },
        ],
      }),
    ).toEqual({ state: "provider_accepted", providerAcceptedAt: COMPLETED_AT });
    expect(
      activeWorkImportInvitationGate({
        connected: true,
        currentEmailValid: true,
        currentEmailHash: "current-hash",
        expectedEmailHash: "current-hash",
        operationKey: "new-operation",
        deliveries: [],
      }),
    ).toEqual({ state: "connected" });
    expect(
      activeWorkImportInvitationGate({
        // A disconnected Artist still has a Clerk id in Client; the caller
        // computes active access and passes false here.
        connected: false,
        currentEmailValid: true,
        currentEmailHash: "current-hash",
        expectedEmailHash: "current-hash",
        operationKey: "new-operation",
        deliveries: [],
      }),
    ).toEqual({ state: "eligible" });
  });
});
