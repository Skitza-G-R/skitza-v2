"use client";

import { useAuth } from "@clerk/nextjs";
import { useLayoutEffect, useMemo, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import {
  canReadArtistRuntimeStudioContext,
  resolveArtistRuntimeStudioContext,
  writeArtistRuntimeStudioContext,
} from "~/lib/runtime-state/artist-context";
import {
  captureAccountPrivateWriteGeneration,
  isAccountPrivateRuntimeWriteAllowed,
} from "~/lib/runtime-state/account-exit";
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
  const writeGeneration = useMemo(
    () => captureAccountPrivateWriteGeneration(identity.userId),
    [identity.userId],
  );

  useLayoutEffect(() => {
    if (
      !privateStateAccessAllowed ||
      !storage ||
      identity.role !== "artist" ||
      !isAccountPrivateRuntimeWriteAllowed(writeGeneration)
    ) {
      return;
    }
    writeArtistRuntimeStudioContext(
      storage,
      identity.userId,
      studioIds,
      identity.contextId,
    );
  }, [identity, privateStateAccessAllowed, storage, studioIds, writeGeneration]);

  return null;
}

export function ArtistRuntimeStateProvider({
  userId,
  studioIds,
  cacheEpoch,
  children,
}: {
  userId: string;
  studioIds: string[];
  cacheEpoch: number | string;
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
      // A queryless server route deterministically renders the first current
      // studio. Do not let a device-only last-studio pointer give the client
      // shell a different identity from the server content.
      requestedStudioId === null ? null : storage,
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
      <RuntimeNavigationBridge cacheEpoch={cacheEpoch} />
      {children}
    </RuntimeStateProvider>
  );
}
