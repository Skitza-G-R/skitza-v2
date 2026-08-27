import { auth } from "~/server/auth/clerk-identity";
import { TRPCError } from "@trpc/server";
import { notFound, redirect } from "next/navigation";

import { CancelSessionScreen } from "~/components/artist/sessions/cancel-session-screen";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { params: Promise<{ sessionId: string }> };

export default async function ArtistSessionCancelPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { sessionId } = await params;
  const caller = appRouter.createCaller({ userId });
  // SK-280: a stale link (archived client contact, deleted booking, malformed
// id from an old push notification or calendar entry) must render the normal
// not-found screen — an uncaught throw here crashed the whole artist shell.
  let session;
  try {
    session = await caller.artist.book.session({ id: sessionId });
  } catch (error) {
    if (error instanceof TRPCError && (error.code === "NOT_FOUND" || error.code === "BAD_REQUEST")) {
      notFound();
    }
    throw error;
  }

  return (
    <CancelSessionScreen
      sessionId={session.id}
      producerId={session.producerId}
      producerName={session.producerName}
      canCancel={session.policy.canCancel}
      held={session.status === "pending_approval"}
    />
  );
}
