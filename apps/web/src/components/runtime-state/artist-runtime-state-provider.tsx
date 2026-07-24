"use client";

import { useAuth } from "@clerk/nextjs";
import { useLayoutEffect, useMemo, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import {
  canReadArtistRuntimeStudioContext,
  resolveArtistRuntimeStudioContext,
  writeArtistRuntimeStudioContext,
} from "~/lib/runtime-state/artist-context";
import { getBrowserRuntimeStorage } from "~/lib/runtime-state/runtime-state";

import { RuntimeNavigationBridge } from "./runtime-navigation-bridge";
import {
  RuntimeStateProvider,
  useRuntimeState,
} from "./runtime-state-provider";

function ArtistRuntimeStudioContextRecorder({
  studioIds,
}: {
  studioIds: readonly string[];
}) {
  const { identity, privateStateAccessAllowed, storage } = useRuntimeState();

  useLayoutEffect(() => {
    if (
      !privateStateAccessAllowed ||
      !storage ||
      identity.role !== "artist"
    ) {
      return;
    }
    writeArtistRuntimeStudioContext(
      storage,
      identity.userId,
      studioIds,
      identity.contextId,
    );
  }, [identity, privateStateAccessAllowed, storage, studioIds]);

  return null;
}

export function ArtistRuntimeStateProvider({
  userId,
  studioIds,
  children,
}: {
  userId: string;
  studioIds: string[];
  children: ReactNode;
}) {
  const { isLoaded, userId: clerkUserId } = useAuth();
  const searchParams = useSearchParams();
  const requestedStudioId = searchParams.get("studio");
  const storage = canReadArtistRuntimeStudioContext(
    isLoaded,
    clerkUserId,
    userId,
  )
    ? getBrowserRuntimeStorage()
    : null;
  const contextId =
    resolveArtistRuntimeStudioContext(
      storage,
      userId,
      studioIds,
      requestedStudioId,
    ) ?? "artist-no-studio";
  const identity = useMemo(
    () => ({ userId, role: "artist" as const, contextId }),
    [contextId, userId],
  );

  return (
    <RuntimeStateProvider identity={identity}>
      <ArtistRuntimeStudioContextRecorder studioIds={studioIds} />
      <RuntimeNavigationBridge />
      {children}
    </RuntimeStateProvider>
  );
}
