import { notFound } from "next/navigation";

import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

import { Sk280Preview } from "./preview";

// SK-280 visual check — the producer- and artist-facing surfaces this wave
// changed, rendered without a signed-in session so each repaired state can be
// inspected directly. Interactions call the real server actions and fail with
// "Please sign in", which is expected here.
export default function Sk280BookingFixesPage() {
  if (!isDevGalleryAvailable()) notFound();
  return <Sk280Preview />;
}
