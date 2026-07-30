import { auth } from "@clerk/nextjs/server";

import type { AllowanceSummary, SessionListItem } from "~/components/artist/sessions/book-data";
import { isArtistSessionsTabKey } from "~/components/artist/sessions/artist-sessions-tabs";
import { MySessionsScreen } from "~/components/artist/sessions/my-sessions-screen";
import { resolveArtistStudioId } from "~/lib/artist-studio-context";
import { readArtistStudioPreference } from "~/server/artist/studio-preference";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { searchParams: Promise<{ studio?: string; tab?: string }> };

export default async function MySessionsPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });
  const [sp, { studios }, savedStudioId] = await Promise.all([
    searchParams,
    caller.artist.studios(),
    readArtistStudioPreference(userId),
  ]);
  const producerId = resolveArtistStudioId(studios, sp.studio, savedStudioId);
  const initialTab = isArtistSessionsTabKey(sp.tab) ? sp.tab : "upcoming";
  const result = producerId
    ? await caller.artist.book.mySessions({ producerId })
    : { sessions: [], allowances: [] };

  const sessions: SessionListItem[] = result.sessions.map((session) => ({
    id: session.id,
    producerId: session.producerId,
    producerName: session.producerName,
    producerSlug: session.producerSlug,
    artistTimezone: session.artistTimezone,
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
    heldExpiryReason: session.heldExpiryReason,
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

  return (
    <MySessionsScreen
      sessions={sessions}
      allowances={allowances}
      nowISO={new Date().toISOString()}
      initialTab={initialTab}
    />
  );
}
