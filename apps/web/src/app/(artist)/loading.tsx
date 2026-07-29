import { Suspense } from "react";

import {
  RuntimeDestinationScaffold,
  RuntimeResumeBoundary,
} from "~/components/runtime-state/runtime-screen-view";

export default function ArtistResumeLoading() {
  return (
    <Suspense
      fallback={
        <RuntimeDestinationScaffold href="/artist" role="artist" />
      }
    >
      <RuntimeResumeBoundary expectedRole="artist" />
    </Suspense>
  );
}
