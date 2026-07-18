import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

type PageProps = { params: Promise<{ productId: string }> };

// Compatibility route for old Store links. The destination owns the signed-in
// product read and its NOT_FOUND authorization behavior.
export default async function StoreProductPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;
  const { productId } = await params;
  redirect(`/artist/purchase/${encodeURIComponent(productId)}`);
}
