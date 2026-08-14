import { auth } from "~/server/auth/clerk-identity";
import { redirect } from "next/navigation";

import { withArtistStudio } from "~/lib/artist-studio-context";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { params: Promise<{ bookingId: string }> };

export default async function LegacyArtistBookingPaymentPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { bookingId } = await params;
  const caller = appRouter.createCaller({ userId });
  const session = await caller.artist.book.session({ id: bookingId });
  redirect(withArtistStudio(`/artist/sessions/${session.id}`, session.producerId));
}
