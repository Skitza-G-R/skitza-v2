import { notFound } from "next/navigation";

import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";

import { Sk305Harness } from "./sk305-harness";

// SK-305 visual check. jsdom proves the wiring but says nothing about how the
// row and the popup actually sit at 390px, which is where CLAUDE.md requires
// mobile work to be judged. Mounts the REAL SongPage and the REAL upload modal
// against prop factories, so what appears here is the shipping component.
//
//   ?state=empty    no lyrics yet
//   ?state=written  a Hebrew sheet already written  (default)
//   ?state=stale    the artist saved first, so the clash bar shows
//   ?role=artist    the artist's side
export default async function Sk305LyricsVisualCheck({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; role?: string }>;
}) {
  if (!isDevGalleryAvailable()) notFound();
  const query = await searchParams;
  return (
    <Sk305Harness
      state={query.state === "empty" ? "empty" : query.state === "stale" ? "stale" : "written"}
      role={query.role === "artist" ? "artist" : "producer"}
    />
  );
}
