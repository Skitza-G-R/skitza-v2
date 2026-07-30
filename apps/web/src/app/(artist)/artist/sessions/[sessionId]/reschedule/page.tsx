import { ArtistBookFlow } from "../../../book/page";

type PageProps = { params: Promise<{ sessionId: string }> };

export default async function ArtistSessionReschedulePage({ params }: PageProps) {
  const { sessionId } = await params;
  return ArtistBookFlow({
    searchParams: Promise.resolve({ session: sessionId }),
  });
}
