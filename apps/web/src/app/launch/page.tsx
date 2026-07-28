import type { Metadata } from "next";
import { Suspense } from "react";

import {
  RuntimeDestinationScaffold,
  RuntimeResumeBoundary,
} from "~/components/runtime-state/runtime-screen-view";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Opening Skitza",
  robots: {
    index: false,
    follow: false,
  },
};

export default function LaunchPage() {
  return (
    <Suspense
      fallback={
        <RuntimeDestinationScaffold href="/dashboard" role="producer" />
      }
    >
      <RuntimeResumeBoundary navigate />
    </Suspense>
  );
}
