import { notFound } from "next/navigation";

import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

import { Sk294OfferShareGallery } from "./sk294-harness";

// SK-294 visual check — the private-offer share surface and the reworked
// Offers work queue, on realistic volume: three offers waiting on an artist
// (one expiring tomorrow, one inside the chase window, one far out) above a
// collapsed History of eleven terminal offers that pages at eight.
//
// The share modal opens from a waiting row exactly as in production; the two
// preview buttons below the queue mount the post-send variants directly,
// because a real send requires an authenticated producer and a database.
// Composer "Send" therefore fails with "Please sign in" here — expected.

export default function Sk294OfferSharePreview() {
  if (!isDevGalleryAvailable()) notFound();
  return <Sk294OfferShareGallery />;
}
