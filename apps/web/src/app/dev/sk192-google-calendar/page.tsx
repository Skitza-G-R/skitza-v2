import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

import { GoogleCalendarPreview } from "./google-calendar-preview";
import { resolveSk192GoogleCalendarPreviewState } from "./preview-state";

export const metadata: Metadata = {
  title: "SK-192 Google Calendar preview",
};

export default async function Sk192GoogleCalendarPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string | string[] }>;
}) {
  if (!isDevGalleryAvailable()) notFound();

  const resolved = await searchParams;
  const requestedState = Array.isArray(resolved.state) ? resolved.state[0] : resolved.state;
  const state = resolveSk192GoogleCalendarPreviewState(requestedState);

  return <GoogleCalendarPreview state={state} />;
}
