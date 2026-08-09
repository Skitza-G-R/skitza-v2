import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

import { Sk195GoogleSyncPreview } from "./sk195-google-sync-preview";

export const metadata: Metadata = {
  title: "SK-195 Google sync preview",
};

export default async function Sk195GoogleSyncPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  if (!isDevGalleryAvailable()) notFound();

  const resolved = await searchParams;
  const requestedView = Array.isArray(resolved.view) ? resolved.view[0] : resolved.view;
  return <Sk195GoogleSyncPreview dialogOpen={requestedView === "dialog"} />;
}
