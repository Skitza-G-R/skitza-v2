import { notFound } from "next/navigation";

import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

import { Sk295Preview } from "./preview";

// SK-295 visual check — the "Bring in active work" phone editor after the
// client-picker and overscroll-anchor fixes, rendered without a signed-in
// session so the repaired flow can be driven and photographed at 390px.
export default function Sk295MobileImportPage() {
  if (!isDevGalleryAvailable()) notFound();
  return <Sk295Preview />;
}
