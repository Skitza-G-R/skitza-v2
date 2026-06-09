import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import {
  MOCK_CANCEL_WINDOW_HOURS,
  MOCK_PRODUCER,
  MOCK_SESSION_DETAIL,
} from "~/components/artist/sessions/book-data";
import { SessionDetailScreen } from "~/components/artist/sessions/session-detail-screen";

type PageProps = { params: Promise<{ sessionId: string }> };

// S12 — Session detail + cancel / reschedule (Book). Mock data while BE-3
// (SK-39) is in flight; when it lands, swap MOCK_* for
// `caller.artist.book.session({ id: sessionId })` — the screen props
// (session + producer + cancelWindowHours) don't change.
export default async function ArtistSessionDetailPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { sessionId } = await params;
  const session = { ...MOCK_SESSION_DETAIL, id: sessionId };
  const producer = MOCK_PRODUCER;

  return (
    <SessionDetailScreen
      session={session}
      producer={producer}
      cancelWindowHours={MOCK_CANCEL_WINDOW_HOURS}
    />
  );
}
