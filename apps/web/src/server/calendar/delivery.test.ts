import { describe, expect, it, vi } from "vitest";

import {
  type CalendarDeliveryJob,
  type CalendarDeliveryRepository,
  type SessionCalendarEmailSender,
  processCalendarSyncJobs,
} from "./delivery";

const now = new Date("2026-08-08T12:00:00.000Z");

function job(overrides: Partial<CalendarDeliveryJob> = {}): CalendarDeliveryJob {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    bookingId: "00000000-0000-4000-8000-000000000002",
    producerId: "00000000-0000-4000-8000-000000000003",
    operation: "send_ics",
    desiredRevision: 3,
    idempotencyKey: "calendar:skitza-use-42:3",
    payloadSnapshot: {
      schemaVersion: 1,
      method: "REQUEST",
      uid: "skitza-use-42@skitza.app",
      sequence: 3,
      dtstampUtc: "2026-08-08T11:59:00.000Z",
      startsAtUtc: "2026-08-09T10:00:00.000Z",
      endsAtUtc: "2026-08-09T11:00:00.000Z",
      summary: "Mix review",
      description: "A confirmed Skitza session.",
      organizer: { name: "Gili", email: "gili@skitza.app" },
      attendee: { name: "Ari", email: "ari@example.com" },
    },
    attemptCount: 1,
    firstAttemptAt: now,
    providerDedupeExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
    createdAt: new Date("2026-08-08T11:59:00.000Z"),
    updatedAt: now,
    ...overrides,
  };
}

function repositoryFor(claimed: readonly CalendarDeliveryJob[]) {
  const claimDueJobs: CalendarDeliveryRepository["claimDueJobs"] = vi
    .fn()
    .mockResolvedValue(claimed);
  const completeJob: CalendarDeliveryRepository["completeJob"] = vi.fn().mockResolvedValue(true);
  const retryJob: CalendarDeliveryRepository["retryJob"] = vi.fn().mockResolvedValue(true);
  const terminalJob: CalendarDeliveryRepository["terminalJob"] = vi.fn().mockResolvedValue(true);
  const repository: CalendarDeliveryRepository = {
    claimDueJobs,
    completeJob,
    retryJob,
    terminalJob,
  };
  return { repository, claimDueJobs, completeJob, retryJob, terminalJob };
}

describe("processCalendarSyncJobs", () => {
  it("renders the immutable snapshot, sends once, and completes the matching lease", async () => {
    const { repository, completeJob } = repositoryFor([job()]);
    const sender = vi.fn<SessionCalendarEmailSender>().mockResolvedValue("email_calendar_42");

    await expect(
      processCalendarSyncJobs(repository, sender, { now, leaseToken: "lease-42" }),
    ).resolves.toEqual({ claimed: 1, completed: 1, retried: 0, terminal: 0, leaseLost: 0 });

    expect(sender).toHaveBeenCalledTimes(1);
    const sent = sender.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      to: "ari@example.com",
      method: "REQUEST",
      summary: "Mix review",
      organizerName: "Gili",
      idempotencyKey: "calendar:skitza-use-42:3",
    });
    expect(sent?.icsContent).toContain("\r\nUID:skitza-use-42@skitza.app\r\n");
    expect(completeJob).toHaveBeenCalledWith({
      jobId: "00000000-0000-4000-8000-000000000001",
      producerId: "00000000-0000-4000-8000-000000000003",
      leaseToken: "lease-42",
      providerMessageId: "email_calendar_42",
      completedAt: now,
    });
  });

  it("requeues a transient provider failure inside the idempotency window", async () => {
    const { repository, retryJob, completeJob } = repositoryFor([job()]);
    const sender = vi
      .fn<SessionCalendarEmailSender>()
      .mockRejectedValue(new Error("Email delivery failed\nsecret detail"));

    await expect(
      processCalendarSyncJobs(repository, sender, { now, leaseToken: "lease-retry" }),
    ).resolves.toEqual({ claimed: 1, completed: 0, retried: 1, terminal: 0, leaseLost: 0 });
    expect(retryJob).toHaveBeenCalledWith({
      jobId: "00000000-0000-4000-8000-000000000001",
      producerId: "00000000-0000-4000-8000-000000000003",
      leaseToken: "lease-retry",
      nextAttemptAt: new Date("2026-08-08T12:00:30.000Z"),
      failedAt: now,
      error: "Email delivery failed secret detail",
    });
    expect(completeJob).not.toHaveBeenCalled();
  });

  it("terminals malformed snapshots without calling the provider", async () => {
    const { repository, terminalJob } = repositoryFor([
      job({ payloadSnapshot: { ...job().payloadSnapshot, sequence: 4 } }),
    ]);
    const sender = vi.fn<SessionCalendarEmailSender>();

    await expect(
      processCalendarSyncJobs(repository, sender, { now, leaseToken: "lease-invalid" }),
    ).resolves.toEqual({ claimed: 1, completed: 0, retried: 0, terminal: 1, leaseLost: 0 });
    expect(sender).not.toHaveBeenCalled();
    expect(terminalJob).toHaveBeenCalledWith({
      jobId: "00000000-0000-4000-8000-000000000001",
      producerId: "00000000-0000-4000-8000-000000000003",
      leaseToken: "lease-invalid",
      terminalAt: now,
      error: "Invalid calendar delivery intent",
    });
  });

  it("does not retry after the provider dedupe window", async () => {
    const { repository: expiredRepository } = repositoryFor([
      job({
        attemptCount: 2,
        firstAttemptAt: new Date(now.getTime() - 24 * 60 * 60 * 1_000),
        providerDedupeExpiresAt: now,
      }),
    ]);
    const sender = vi.fn<SessionCalendarEmailSender>();
    await expect(
      processCalendarSyncJobs(expiredRepository, sender, { now, leaseToken: "lease-expired" }),
    ).resolves.toMatchObject({ terminal: 1 });
    expect(sender).not.toHaveBeenCalled();
  });

  it("reports a lost lease instead of overwriting another worker's result", async () => {
    const { repository, completeJob } = repositoryFor([job()]);
    vi.mocked(completeJob).mockResolvedValueOnce(false);

    await expect(
      processCalendarSyncJobs(
        repository,
        vi.fn<SessionCalendarEmailSender>().mockResolvedValue("email-42"),
        {
          now,
          leaseToken: "lost-lease",
        },
      ),
    ).resolves.toEqual({ claimed: 1, completed: 0, retried: 0, terminal: 0, leaseLost: 1 });
  });
});
