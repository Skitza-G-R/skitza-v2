import { notFound } from "next/navigation";

import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

import { Sk268Preview } from "./preview";

// SK-268 visual check — the "Bring in active work" surfaces this wave changed,
// rendered without a signed-in session so each repaired state can be inspected
// and photographed at 360px, 390px and desktop.
export default function Sk268ImportedWorkPage() {
  if (!isDevGalleryAvailable()) notFound();
  return <Sk268Preview />;
}
