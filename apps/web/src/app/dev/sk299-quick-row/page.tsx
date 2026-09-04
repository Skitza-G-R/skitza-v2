import { notFound } from "next/navigation";

import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

import { Sk299Preview } from "./preview";

// SK-299 visual check — the quick row and the screen that follows an import,
// rendered without a signed-in session so both can be inspected and
// photographed at 360px, 390px and desktop. jsdom cannot see layout.
export default function Sk299QuickRowPage() {
  if (!isDevGalleryAvailable()) notFound();
  return <Sk299Preview />;
}
