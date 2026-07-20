import { auth } from "@clerk/nextjs/server";

import type { AllowanceSummary, SessionListItem } from "~/components/artist/sessions/book-data";
import { MySessionsScreen } from "~/components/artist/sessions/my-sessions-screen";
import { appRouter } from "~/server/trpc/routers/_app";

export default async function MySessionsPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });
  const result = await caller.artist.book.mySessions();

  const sessions: SessionListItem[] = result.sessions.map((session) => ({
    id: session.id,
    producerId: session.producerId,
    producerName: session.producerName,
    producerSlug: session.producerSlug,
    producerTimezone: session.producerTimezone,
    projectId: session.projectId,
    projectTitle: session.projectTitle,
    purchaseId: session.purchaseId,
    sessionAllowanceId: session.sessionAllowanceId,
    startsAtISO: session.startsAt.toISOString(),
    durationMin: session.durationMin,
    packageName: session.packageName,
    locationType: session.locationType,
    status: session.status,
    outcome: session.outcome,
    rescheduledFromBookingId: session.rescheduledFromBookingId,
    policy: {
      cancellationPolicyHours: session.policy.cancellationPolicyHours,
      cancellationDeadlineISO: session.policy.cancellationDeadline.toISOString(),
      isOnTime: session.policy.isOnTime,
      canCancel: session.policy.canCancel,
      canReschedule: session.policy.canReschedule,
    },
  }));
  const allowances: AllowanceSummary[] = result.allowances.map((allowance) => ({
    purchaseId: allowance.purchaseId,
    sessionAllowanceId: allowance.sessionAllowanceId,
    producerId: allowance.producerId,
    producerName: allowance.producerName,
    projectId: allowance.projectId,
    projectTitle: allowance.projectTitle,
    packageName: allowance.packageName,
    kind: allowance.kind,
    sessionLimit: allowance.sessionLimit,
    sessionsUsed: allowance.sessionsUsed,
    sessionsRemaining: allowance.sessionsRemaining,
    durationMin: allowance.durationMin,
    locationType: allowance.locationType,
    bufferMinutes: allowance.bufferMinutes,
    minLeadHours: allowance.minLeadHours,
    closedAtISO: allowance.closedAt?.toISOString() ?? null,
    canBook: allowance.canBook,
    bookingBlockedReason: allowance.bookingBlockedReason,
  }));

  return <MySessionsScreen sessions={sessions} allowances={allowances} />;
}
