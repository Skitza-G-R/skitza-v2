"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const PROOF_QUEUE_REFRESH_MS = 5_000;

export function ProofQueueRefresh({ enabled = true }: { enabled?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const intervalId = window.setInterval(refreshIfVisible, PROOF_QUEUE_REFRESH_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshIfVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshIfVisible);
    };
  }, [enabled, router]);
  return null;
}
