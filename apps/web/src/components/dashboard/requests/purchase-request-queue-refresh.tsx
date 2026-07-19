"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const PURCHASE_REQUEST_REFRESH_MS = 5_000;

/** Keep an already-open new-work queue in sync with artist submissions. */
export function PurchaseRequestQueueRefresh() {
  const router = useRouter();

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const intervalId = window.setInterval(refreshIfVisible, PURCHASE_REQUEST_REFRESH_MS);

    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshIfVisible);
    window.addEventListener("pageshow", refreshIfVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshIfVisible);
      window.removeEventListener("pageshow", refreshIfVisible);
    };
  }, [router]);

  return null;
}
