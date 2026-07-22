import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { withArtistStudio } from "~/lib/artist-studio-context";

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ studio?: string }>;
};

// Compatibility route for old Store links. The destination owns the signed-in
// product read and its NOT_FOUND authorization behavior.
export default async function StoreProductPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;
  const { productId } = await params;
  const { studio } = await searchParams;
  redirect(withArtistStudio(`/artist/purchase/${encodeURIComponent(productId)}`, studio));
}
