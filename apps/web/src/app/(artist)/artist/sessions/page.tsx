import { auth } from "@clerk/nextjs/server";

import {
  MOCK_ACTIVE_BOOKING,
  MOCK_PRODUCER,
  MOCK_SESSIONS,
} from "~/components/artist/sessions/book-data";
import { MySessionsScreen } from "~/components/artist/sessions/my-sessions-screen";

// S11 — "My sessions" standing screen. Mock data while BE-3 (SK-39) is in
// flight; when artist.book.mySessions lands, swap MOCK_* for the tRPC caller's
// real sessions + active package — the screen props don't change. The artist
// layout already gates non-signed-in traffic; the auth() call here is
// defense-in-depth (middleware → layout → page).
export default async function MySessionsPage() {
  const { userId } = await auth();
  if (!userId) return null;

  return (
    <MySessionsScreen
      sessions={MOCK_SESSIONS}
      activeBooking={MOCK_ACTIVE_BOOKING}
      producerName={MOCK_PRODUCER.name}
    />
  );
}
