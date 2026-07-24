"use client";

import { useMemo, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import { RuntimeNavigationBridge } from "./runtime-navigation-bridge";
import { RuntimeStateProvider } from "./runtime-state-provider";

export function ArtistRuntimeStateProvider({
  userId,
  studioIds,
  children,
}: {
  userId: string;
  studioIds: string[];
  children: ReactNode;
}) {
  const searchParams = useSearchParams();
  const requestedStudioId = searchParams.get("studio");
  const contextId =
    (requestedStudioId && studioIds.includes(requestedStudioId)
      ? requestedStudioId
      : studioIds[0]) ?? "artist-no-studio";
  const identity = useMemo(
    () => ({ userId, role: "artist" as const, contextId }),
    [contextId, userId],
  );

  return (
    <RuntimeStateProvider identity={identity}>
      <RuntimeNavigationBridge />
      {children}
    </RuntimeStateProvider>
  );
}
