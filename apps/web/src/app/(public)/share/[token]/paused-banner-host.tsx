"use client";

import { PausedBanner } from "~/components/project/paused-banner";
import { requestCustomerPortal } from "./actions";

// Thin client-side wrapper around PausedBanner. The server-side share
// page can't pass the server action directly into a client component
// that lives outside this folder (paused-banner.tsx is a generic
// component under ~/components/project), so we keep the action import
// + closure here and forward only the resolved URL into the banner.
export function PausedBannerHost({
  projectId,
  token,
}: {
  projectId: string;
  token: string;
}) {
  return (
    <PausedBanner
      onRequestPortal={async () => {
        const res = await requestCustomerPortal({ projectId, shareToken: token });
        if (!res.ok) {
          // Bubble the message up so the banner's catch sets local state.
          throw new Error(res.error);
        }
        return { url: res.url };
      }}
    />
  );
}
