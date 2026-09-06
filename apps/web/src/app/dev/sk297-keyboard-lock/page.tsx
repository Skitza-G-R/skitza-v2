import { notFound } from "next/navigation";

import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

import { Sk297Preview } from "./preview";

// SK-297 visual check — the "Bring in active work" phone editor over a long
// scrollable workspace, with the software keyboard simulated the way
// NativeViewportSync reports it on iOS, so the body scroll lock can be
// photographed on and off at 390px and 360px.
export default function Sk297KeyboardLockPage() {
  if (!isDevGalleryAvailable()) notFound();
  return <Sk297Preview />;
}
