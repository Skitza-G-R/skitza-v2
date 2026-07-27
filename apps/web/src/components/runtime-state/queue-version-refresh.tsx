"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  createQueueVersionChecker,
  createVisibleQueueVersionCheck,
  listenForQueueVersionActivity,
} from "~/lib/runtime-state/queue-version-polling";

const VERSION_PATTERN = /^v1\.[A-Za-z0-9_-]{43}$/;

async function fetchQueueVersion(endpoint: string, signal: AbortSignal): Promise<string | null> {
  const result = await fetch(endpoint, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!result.ok) return null;
  const body: unknown = await result.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("version" in body) ||
    typeof body.version !== "string" ||
    !VERSION_PATTERN.test(body.version)
  ) {
    return null;
  }
  return body.version;
}

export function useQueueVersionRefresh({
  enabled = true,
  endpoint,
  initialVersion,
  intervalMs,
  refreshOnFocus = false,
  refreshOnOnline = true,
  refreshOnPageShow = true,
  refreshOnVisibilityChange = false,
  onlyWhenVisible = true,
}: {
  enabled?: boolean;
  endpoint: string | null;
  initialVersion: string | null;
  intervalMs: number;
  refreshOnFocus?: boolean;
  refreshOnOnline?: boolean;
  refreshOnPageShow?: boolean;
  refreshOnVisibilityChange?: boolean;
  onlyWhenVisible?: boolean;
}): void {
  const router = useRouter();

  useEffect(() => {
    if (!enabled || !endpoint || !initialVersion) return;

    const abortController = new AbortController();
    const checker = createQueueVersionChecker({
      initialVersion,
      loadVersion: () => fetchQueueVersion(endpoint, abortController.signal),
      onVersionChanged: () => {
        router.refresh();
      },
    });
    const check = createVisibleQueueVersionCheck({
      check: checker.check,
      isVisible: () => document.visibilityState === "visible",
      onlyWhenVisible,
    });
    const intervalId = window.setInterval(check, intervalMs);
    const stopListeningForActivity = listenForQueueVersionActivity({
      check,
      documentTarget: document,
      refreshOnFocus,
      refreshOnOnline,
      refreshOnPageShow,
      refreshOnVisibilityChange,
      windowTarget: window,
    });
    // This also covers reconnects where an `enabled` transition mounts the
    // effect after the browser's online event has already fired.
    check();

    return () => {
      window.clearInterval(intervalId);
      stopListeningForActivity();
      checker.stop();
      abortController.abort();
    };
  }, [
    enabled,
    endpoint,
    initialVersion,
    intervalMs,
    onlyWhenVisible,
    refreshOnFocus,
    refreshOnOnline,
    refreshOnPageShow,
    refreshOnVisibilityChange,
    router,
  ]);
}

export function QueueVersionRefresh(props: Parameters<typeof useQueueVersionRefresh>[0]): null {
  useQueueVersionRefresh(props);
  return null;
}
