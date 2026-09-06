import { notFound } from "next/navigation";

import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

import { Sk308Preview } from "./preview";

// SK-308 visual check — the simplified "Bring in active work" item editor
// (Client / Project with product tiles / Payments) rendered without a signed-in
// session so it can be driven and photographed at 360px, 390px and desktop.
export default function Sk308ImportPage() {
  if (!isDevGalleryAvailable()) notFound();
  return <Sk308Preview />;
}
