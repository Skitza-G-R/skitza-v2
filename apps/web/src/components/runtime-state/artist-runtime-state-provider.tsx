"use client";

import { useAuth } from "@clerk/nextjs";
import { useLayoutEffect, useMemo, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import { resolveArtistStudioId } from "~/lib/artist-studio-context";
import {
  clearArtistStudioPreferenceCookie,
  writeArtistStudioPreferenceCookie,
} from "~/lib/artist-studio-preference-client";
import { writeArtistRuntimeStudioContext } from "~/lib/runtime-state/artist-context";
import {
  captureAccountPrivateWriteGeneration,
  isAccountPrivateRuntimeWriteAllowed,
} from "~/lib/runtime-state/account-exit";
import { RuntimeNavigationBridge } from "./runtime-navigation-bridge";
import { RuntimeStateProvider, useRuntimeState } from "./runtime-state-provider";

function ArtistRuntimeStudioContextRecorder({
  studioIds,
  authIsLoaded,
  authenticatedUserId,
}: {
  studioIds: readonly string[];
  authIsLoaded: boolean;
  authenticatedUserId: string | null | undefined;
}) {
  const { identity, privateStateAccessAllowed, storage } = useRuntimeState();
  const writeGeneration = useMemo(
    () => captureAccountPrivateWriteGeneration(identity.userId),
    [identity.userId],
  );

  useLayoutEffect(() => {
    if (!authIsLoaded || authenticatedUserId !== identity.userId) return;
    if (studioIds.includes(identity.contextId)) {
      writeArtistStudioPreferenceCookie(identity.userId, identity.contextId);
    } else {
      clearArtistStudioPreferenceCookie();
    }
  }, [authIsLoaded, authenticatedUserId, identity, studioIds]);

  useLayoutEffect(() => {
    if (
      !privateStateAccessAllowed ||
      !storage ||
      identity.role !== "artist" ||
      !isAccountPrivateRuntimeWriteAllowed(writeGeneration)
    ) {
      return;
    }
    writeArtistRuntimeStudioContext(storage, identity.userId, studioIds, identity.contextId);
  }, [identity, privateStateAccessAllowed, storage, studioIds, writeGeneration]);

  return null;
}

export function ArtistRuntimeStateProvider({
  userId,
  studioIds,
  initialStudioId,
  cacheEpoch,
  children,
}: {
  userId: string;
  studioIds: string[];
  initialStudioId: string | null;
  cacheEpoch: number | string;
  children: ReactNode;
}) {
  const { isLoaded, userId: clerkUserId } = useAuth();
  const searchParams = useSearchParams();
  const requestedStudioId = searchParams.get("studio");
  const contextId =
    resolveArtistStudioId(
      studioIds.map((producerId) => ({ producerId })),
      requestedStudioId,
      initialStudioId,
    ) ?? "artist-no-studio";
  const identity = useMemo(
    () => ({ userId, role: "artist" as const, contextId }),
    [contextId, userId],
  );

  return (
    <RuntimeStateProvider identity={identity}>
      <ArtistRuntimeStudioContextRecorder
        studioIds={studioIds}
        authIsLoaded={isLoaded}
        authenticatedUserId={clerkUserId}
      />
      <RuntimeNavigationBridge cacheEpoch={cacheEpoch} />
      {children}
    </RuntimeStateProvider>
  );
}
