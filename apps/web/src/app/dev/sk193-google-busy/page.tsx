import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

import { GoogleCalendarPreview } from "../sk192-google-calendar/google-calendar-preview";

export const metadata: Metadata = {
  title: "SK-193 Google busy-time preview",
};

export default function Sk193GoogleBusyPreviewPage() {
  if (!isDevGalleryAvailable()) notFound();

  return (
    <GoogleCalendarPreview
      state="connected"
      googleBusyProtectionReduced
      googleControlOpen={false}
    />
  );
}
