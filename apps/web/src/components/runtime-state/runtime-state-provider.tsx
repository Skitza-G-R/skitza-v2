"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { createContext, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

import {
  getBrowserRuntimeStorage,
  type RuntimeRole,
  type StorageLike,
} from "~/lib/runtime-state/runtime-state";
import { clearAccountPrivateRuntimeState } from "~/lib/runtime-state/account-exit";

export interface RuntimeIdentity {
  userId: string;
  role: RuntimeRole;
  contextId: string;
}

interface RuntimeStateContextValue {
  identity: RuntimeIdentity;
  storage: StorageLike | null;
  privateStateAccessAllowed: boolean;
}

const RuntimeStateContext = createContext<RuntimeStateContextValue | null>(null);

export function clearRuntimeStateBeforeSignOut<Result>(
  storage: StorageLike | null,
  userId: string,
  signOut: () => Result,
): Result {
  clearAccountPrivateRuntimeState(userId, storage);
  return signOut();
}

export function shouldConcealRuntimeContent(
  clerkLoaded: boolean,
  clerkUserId: string | null | undefined,
  serverUserId: string,
  serverIdentityWasVerified = false,
): boolean {
  return clerkLoaded ? clerkUserId !== serverUserId : serverIdentityWasVerified;
}

export function runtimeUserToClear(
  previousUserId: string | null,
  currentUserId: string | null,
): string | null {
  return previousUserId && previousUserId !== currentUserId ? previousUserId : null;
}

export function RuntimeStateProvider({
  identity,
  children,
}: {
  identity: RuntimeIdentity;
  children: ReactNode;
}) {
  const { isLoaded, userId: clerkUserId } = useAuth();
  const previousUserId = useRef<string | null>(clerkUserId ?? identity.userId);
  const storage = getBrowserRuntimeStorage();
  const privateStateAccessAllowed = isLoaded && clerkUserId === identity.userId;
  const verifiedServerUserId = useRef<string | null>(
    privateStateAccessAllowed ? identity.userId : null,
  );

  useLayoutEffect(() => {
    if (!isLoaded) return;
    const currentUserId = clerkUserId ?? null;
    const userIdToClear = runtimeUserToClear(previousUserId.current, currentUserId);
    if (userIdToClear) {
      clearAccountPrivateRuntimeState(userIdToClear, storage);
    }
    previousUserId.current = currentUserId;
  }, [clerkUserId, identity.userId, isLoaded, storage]);

  useLayoutEffect(() => {
    if (privateStateAccessAllowed) verifiedServerUserId.current = identity.userId;
  }, [identity.userId, privateStateAccessAllowed]);

  const value = useMemo<RuntimeStateContextValue>(
    () => ({ identity, privateStateAccessAllowed, storage }),
    [identity, privateStateAccessAllowed, storage],
  );

  // A live Clerk transition can precede the next server layout response.
  // Conceal the old server tree immediately; account-scoped keys also make
  // it impossible for the next identity to read the previous user's cache.
  if (
    shouldConcealRuntimeContent(
      isLoaded,
      clerkUserId,
      identity.userId,
      verifiedServerUserId.current === identity.userId,
    )
  ) {
    return (
      <div
        aria-busy="true"
        aria-label="Switching account"
        className="min-h-dvh bg-[rgb(var(--bg-background))]"
      />
    );
  }

  return <RuntimeStateContext.Provider value={value}>{children}</RuntimeStateContext.Provider>;
}

export function useRuntimeState(): RuntimeStateContextValue {
  const value = useContext(RuntimeStateContext);
  if (!value) {
    throw new Error("useRuntimeState must be used inside RuntimeStateProvider.");
  }
  return value;
}

/**
 * Deterministic sign-out adapter for any explicit app sign-out control. It
 * removes private runtime state before Clerk can redirect or unmount the shell.
 */
export function useRuntimeSignOut() {
  const { identity, storage } = useRuntimeState();
  const clerk = useClerk();
  return () => clearRuntimeStateBeforeSignOut(storage, identity.userId, () => clerk.signOut());
}
