import { Suspense } from "react";

import {
  RuntimeDestinationScaffold,
  RuntimeResumeBoundary,
} from "~/components/runtime-state/runtime-screen-view";

export default function ProducerResumeLoading() {
  return (
    <Suspense
      fallback={
        <RuntimeDestinationScaffold href="/dashboard" role="producer" />
      }
    >
      <RuntimeResumeBoundary expectedRole="producer" />
    </Suspense>
  );
}
