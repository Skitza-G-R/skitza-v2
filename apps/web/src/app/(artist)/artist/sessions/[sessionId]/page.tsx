import { auth } from "~/server/auth/clerk-identity";
import { redirect } from "next/navigation";

import type { SessionDetail } from "~/components/artist/sessions/book-data";
import { SessionDetailScreen } from "~/components/artist/sessions/session-detail-screen";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { params: Promise<{ sessionId: string }> };

export default async function ArtistSessionDetailPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { sessionId } = await params;
  const caller = appRouter.createCaller({ userId });
  const row = await caller.artist.book.session({ id: sessionId });
  const session: SessionDetail = {
    id: row.id,
    producerId: row.producerId,
    producerName: row.producerName,
    producerSlug: row.producerSlug,
    artistTimezone: row.artistTimezone,
    producerTimezone: row.producerTimezone,
    projectId: row.projectId,
    projectTitle: row.projectTitle,
    purchaseId: row.purchaseId,
    sessionAllowanceId: row.sessionAllowanceId,
    startsAtISO: row.startsAt.toISOString(),
    durationMin: row.durationMin,
    packageName: row.packageName,
    locationType: row.locationType,
    status: row.status,
    outcome: row.outcome,
    billingTreatment: row.billingTreatment,
    artistRsvpStatus: row.artistRsvpStatus,
    artistRsvpRespondedAtISO: row.artistRsvpRespondedAt?.toISOString() ?? null,
    changeRequest: row.changeRequest
      ? {
          id: row.changeRequest.id,
          kind: row.changeRequest.kind,
          status: "pending",
          proposedStartsAtISO: row.changeRequest.proposedStartsAt?.toISOString() ?? null,
          requestedAtISO: row.changeRequest.requestedAt.toISOString(),
        }
      : null,
    rescheduledFromBookingId: row.rescheduledFromBookingId,
    heldExpiryReason: row.heldExpiryReason,
    policy: {
      cancellationPolicyHours: row.policy.cancellationPolicyHours,
      cancellationDeadlineISO: row.policy.cancellationDeadline.toISOString(),
      isOnTime: row.policy.isOnTime,
      canCancel: row.policy.canCancel,
      canReschedule: row.policy.canReschedule,
    },
    bufferMinutes: row.bufferMinutes,
    minLeadHours: row.minLeadHours,
    autoConfirm: row.autoConfirm,
  };

  return <SessionDetailScreen session={session} />;
}
