import { describe, expect, it, vi } from "vitest";

import type { GoogleCalendarLinkedEventReader } from "~/server/google-calendar";

import {
  type GoogleCalendarPreparedReconciliation,
  type GoogleCalendarReconciliationApply,
  type GoogleCalendarReconciliationJob,
  type GoogleCalendarReconciliationRepository,
  processGoogleCalendarReconciliations,
} from "./google-reconciliation";

const NOW = new Date("2026-08-09T12:00:00.000Z");
const JOB_ID = "00000000-0000-4000-8000-000000000001";
const BOOKING_ID = "00000000-0000-4000-8000-000000000002";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000003";
const LINK_ID = "00000000-0000-4000-8000-000000000004";

function job(attemptCount = 1): GoogleCalendarReconciliationJob {
  return {
    id: JOB_ID,
    bookingId: BOOKING_ID,
    producerId: PRODUCER_ID,
    bookingCalendarLinkId: LINK_ID,
    desiredRevision: 3,
    payloadSnapshot: {
      schemaVersion: 3,
      action: "reconcile",
      source: "recovery",
      watchId: null,
      messageNumber: null,
    },
    attemptCount,
  };
}

function prepared(claimed = job()): GoogleCalendarPreparedReconciliation {
  return {
    job: claimed,
    currentBookingId: BOOKING_ID,
    artistEmail: "artist@example.com",
    link: {
      id: LINK_ID,
      producerId: PRODUCER_ID,
      connectionId: "00000000-0000-4000-8000-000000000005",
      accountVersion: 1,
      destinationSelectionId: "00000000-0000-4000-8000-000000000006",
      destinationCalendarIdCiphertext: "ciphertext",
      destinationCalendarIdIv: "abcdefghijklmnop",
      destinationCalendarIdAuthTag: "abcdefghijklmnopqrstuv",
      destinationCalendarIdKeyVersion: 1,
      providerEventId: "sk00000000000040008000000000000004",
      providerEventEtag: '"etag-3"',
      providerState: "active",
      syncState: "synced",
      desiredRevision: 3,
      lastGoogleRevision: 3,
      invitationRevision: 3,
      invitationChannel: "google",
      invitationReservedAt: NOW,
      invitationAttemptedAt: NOW,
      invitationDeliveredAt: NOW,
    },
  };
}

function repositoryFor(claimed = job()) {
  const prepareGoogleReconciliationJob = vi
    .fn<GoogleCalendarReconciliationRepository["prepareGoogleReconciliationJob"]>()
    .mockResolvedValue({ outcome: "ready", value: prepared(claimed) });
  const completeSupersededGoogleReconciliationJob = vi
    .fn<GoogleCalendarReconciliationRepository["completeSupersededGoogleReconciliationJob"]>()
    .mockResolvedValue(true);
  const completeDisconnectedGoogleReconciliationJob = vi
    .fn<GoogleCalendarReconciliationRepository["completeDisconnectedGoogleReconciliationJob"]>()
    .mockResolvedValue(true);
  const retryGoogleReconciliationJob = vi
    .fn<GoogleCalendarReconciliationRepository["retryGoogleReconciliationJob"]>()
    .mockResolvedValue(true);
  const terminalGoogleReconciliationJob = vi
    .fn<GoogleCalendarReconciliationRepository["terminalGoogleReconciliationJob"]>()
    .mockResolvedValue(true);
  const repository: GoogleCalendarReconciliationRepository = {
    claimDueGoogleReconciliationJobs: vi.fn().mockResolvedValue([claimed]),
    prepareGoogleReconciliationJob,
    completeSupersededGoogleReconciliationJob,
    completeDisconnectedGoogleReconciliationJob,
    retryGoogleReconciliationJob,
    terminalGoogleReconciliationJob,
    enqueueGoogleReconciliationRecovery: vi.fn().mockResolvedValue({ scanned: 0, jobsEnqueued: 0 }),
  };
  return {
    repository,
    prepareGoogleReconciliationJob,
    completeSupersededGoogleReconciliationJob,
    completeDisconnectedGoogleReconciliationJob,
    retryGoogleReconciliationJob,
    terminalGoogleReconciliationJob,
  };
}

describe("Google Calendar known-link reconciliation worker", () => {
  it("completes a superseded job without reading Google", async () => {
    const {
      repository,
      prepareGoogleReconciliationJob,
      completeSupersededGoogleReconciliationJob,
    } = repositoryFor();
    prepareGoogleReconciliationJob.mockResolvedValueOnce({
      outcome: "superseded",
    });
    const reader = vi.fn<GoogleCalendarLinkedEventReader>();

    await expect(
      processGoogleCalendarReconciliations(
        { repository, reader, apply: vi.fn() },
        { now: NOW, leaseToken: "lease-superseded" },
      ),
    ).resolves.toMatchObject({ claimed: 1, unchanged: 1, leaseLost: 0 });
    expect(reader).not.toHaveBeenCalled();
    expect(completeSupersededGoogleReconciliationJob).toHaveBeenCalledWith({
      jobId: JOB_ID,
      producerId: PRODUCER_ID,
      leaseToken: "lease-superseded",
      completedAt: NOW,
    });
  });

  it("reads only the prepared linked event with its ETag and applies it after the read", async () => {
    const { repository } = repositoryFor();
    const reader = vi.fn<GoogleCalendarLinkedEventReader>().mockResolvedValue({
      status: "ready",
      lookup: { outcome: "not_modified" },
    });
    const apply = vi
      .fn<GoogleCalendarReconciliationApply>()
      .mockResolvedValue({ outcome: "unchanged" });

    await expect(
      processGoogleCalendarReconciliations(
        { repository, reader, apply },
        { now: NOW, leaseToken: "lease-reconcile" },
      ),
    ).resolves.toMatchObject({ claimed: 1, unchanged: 1, leaseLost: 0 });
    expect(reader).toHaveBeenCalledWith(prepared().link, {
      artistEmail: "artist@example.com",
      ifNoneMatch: '"etag-3"',
    });
    expect(apply).toHaveBeenCalledWith(
      prepared(),
      { outcome: "not_modified" },
      {
        leaseToken: "lease-reconcile",
        reconciledAt: NOW,
      },
    );
  });

  it("marks a disconnected connection safely without applying remote data", async () => {
    const { repository, completeDisconnectedGoogleReconciliationJob } = repositoryFor();
    const reader = vi
      .fn<GoogleCalendarLinkedEventReader>()
      .mockResolvedValue({ status: "reconnect_required" });
    const apply = vi.fn<GoogleCalendarReconciliationApply>();

    const result = await processGoogleCalendarReconciliations(
      { repository, reader, apply },
      { now: NOW, leaseToken: "lease-disconnected" },
    );

    expect(result.disconnected).toBe(1);
    expect(apply).not.toHaveBeenCalled();
    expect(completeDisconnectedGoogleReconciliationJob).toHaveBeenCalledWith({
      jobId: JOB_ID,
      producerId: PRODUCER_ID,
      leaseToken: "lease-disconnected",
      linkId: LINK_ID,
      completedAt: NOW,
      reconnectRequired: true,
    });
  });

  it("retries a temporary provider outage with only a safe error code", async () => {
    const { repository, retryGoogleReconciliationJob } = repositoryFor();
    const reader = vi
      .fn<GoogleCalendarLinkedEventReader>()
      .mockResolvedValue({ status: "unavailable" });

    const result = await processGoogleCalendarReconciliations(
      { repository, reader, apply: vi.fn() },
      { now: NOW, leaseToken: "lease-retry" },
    );

    expect(result.retried).toBe(1);
    expect(retryGoogleReconciliationJob).toHaveBeenCalledWith({
      jobId: JOB_ID,
      producerId: PRODUCER_ID,
      leaseToken: "lease-retry",
      linkId: LINK_ID,
      failedAt: NOW,
      nextAttemptAt: new Date("2026-08-09T12:00:30.000Z"),
      errorCode: "provider_unavailable",
    });
  });

  it("stops after the bounded retry limit", async () => {
    const claimed = job(12);
    const { repository, terminalGoogleReconciliationJob } = repositoryFor(claimed);
    const reader = vi
      .fn<GoogleCalendarLinkedEventReader>()
      .mockRejectedValue(new Error("secret provider response"));

    const result = await processGoogleCalendarReconciliations(
      { repository, reader, apply: vi.fn() },
      { now: NOW, leaseToken: "lease-terminal" },
    );

    expect(result.terminal).toBe(1);
    expect(terminalGoogleReconciliationJob).toHaveBeenCalledWith({
      jobId: JOB_ID,
      producerId: PRODUCER_ID,
      leaseToken: "lease-terminal",
      linkId: LINK_ID,
      terminalAt: NOW,
      errorCode: "unknown",
    });
  });
});
