import { notFound } from "next/navigation";

import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

import { Sk284Preview } from "./preview";

// SK-283 + SK-284 visual check — the producer overview's Needs You queue
// rendered without a signed-in session, so the corrected action links and the
// new dismiss control can be inspected at 360px, 390px and desktop.
//
// The ✕ calls the real server action and fails with "Please sign in" here.
// That is expected: this gallery exists to check layout and states, and the
// button's behaviour is covered by
// __tests__/needs-you-dismiss-button.interaction.test.tsx.
export default function Sk284NeedsYouPage() {
  if (!isDevGalleryAvailable()) notFound();
  return <Sk284Preview />;
}
