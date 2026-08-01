import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { CancelSessionScreen } from "~/components/artist/sessions/cancel-session-screen";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { params: Promise<{ sessionId: string }> };

export default async function ArtistSessionCancelPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { sessionId } = await params;
  const caller = appRouter.createCaller({ userId });
  const session = await caller.artist.book.session({ id: sessionId });

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
