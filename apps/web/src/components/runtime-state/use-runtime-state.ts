"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  readRuntimeState,
  runtimeScope,
  writeRuntimeState,
  type ArtistHomeSafeView,
  type ProducerDisplayNameDraft,
  type ProducerOverviewSafeView,
  type RuntimePayloadBySlot,
  type RuntimeSlot,
} from "~/lib/runtime-state/runtime-state";
import {
  clearProducerDisplayNameDraft,
  clearRuntimeTextDraft,
  readProducerDisplayNameDraft,
  readRuntimeTextDraft,
  writeProducerDisplayNameDraft,
  writeRuntimeTextDraft,
  type RuntimeTextDraftSlot,
} from "~/lib/runtime-state/drafts";

import { useRuntimeState } from "./runtime-state-provider";
import { useOnlineStatus } from "./online-required-link";

type SafeViewSlot = "producer.overview.safe-view" | "artist.home.safe-view";

export interface RuntimeCachedViewResult<Slot extends SafeViewSlot> {
  data: RuntimePayloadBySlot[Slot] | undefined;
  source: "unseen" | "cache" | "server";
  refreshing: boolean;
}

export function useRuntimeCachedView<Slot extends SafeViewSlot>({
  slot,
  route,
  contextId,
  serverData,
}: {
  slot: Slot;
  route: string;
  contextId?: string;
  serverData?: RuntimePayloadBySlot[Slot];
}): RuntimeCachedViewResult<Slot> {
  const { identity, privateStateAccessAllowed, storage } = useRuntimeState();
  const online = useOnlineStatus();
  const [data, setData] = useState<RuntimePayloadBySlot[Slot] | undefined>(serverData);
  const [source, setSource] = useState<"unseen" | "cache" | "server">(
    serverData ? "server" : "unseen",
  );
  const resolvedContextId = contextId ?? identity.contextId;
  const scope = useMemo(
    () => runtimeScope(identity.userId, identity.role, resolvedContextId, route),
    [identity.role, identity.userId, resolvedContextId, route],
  );
  const scopeKey = scope
    ? `${scope.userId}:${scope.role}:${scope.contextId}:${scope.route}:${slot}`
    : "invalid";
  const cacheReadBeforePaint = useRef(false);

  useLayoutEffect(() => {
    if (!privateStateAccessAllowed || !storage || !scope) return;
    const cached = readRuntimeState(storage, scope, slot);
    if (cached) {
      cacheReadBeforePaint.current = true;
      setData(cached);
      setSource("cache");
    } else if (serverData) {
      cacheReadBeforePaint.current = false;
      setData(serverData);
      setSource("server");
    } else {
      cacheReadBeforePaint.current = false;
      setData(undefined);
      setSource("unseen");
    }
  }, [privateStateAccessAllowed, scope, scopeKey, serverData, slot, storage]);

  useEffect(() => {
    if (!privateStateAccessAllowed || !storage || !scope || !serverData) return;
    // Layout effects flush before the browser paints. When an offline launch
    // found a cache, keep that useful snapshot in memory instead of replacing
    // it with the server prop captured before connectivity was lost.
    if (!online && cacheReadBeforePaint.current) return;
    if (!cacheReadBeforePaint.current) {
      writeRuntimeState(storage, scope, slot, serverData);
      setData(serverData);
      setSource("server");
      return;
    }

    // A layout-effect state update can flush passive effects before the first
    // paint. Two animation frames guarantee the cached snapshot gets one real
    // paint before the current server value replaces it silently.
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        writeRuntimeState(storage, scope, slot, serverData);
        setData(serverData);
        setSource("server");
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [online, privateStateAccessAllowed, scope, scopeKey, serverData, slot, storage]);

  return { data, source, refreshing: source === "cache" && Boolean(serverData) };
}

export function useRuntimeTextDraft({
  slot,
  route,
  contextId,
  resourceId,
}: {
  slot: RuntimeTextDraftSlot;
  route: string;
  contextId?: string;
  resourceId: string;
}) {
  const { identity, privateStateAccessAllowed, storage } = useRuntimeState();
  const [body, setBody] = useState("");
  const resolvedContextId = contextId ?? identity.contextId;
  const scope = useMemo(
    () => runtimeScope(identity.userId, identity.role, resolvedContextId, route),
    [identity.role, identity.userId, resolvedContextId, route],
  );
  const scopeKey = scope
    ? `${scope.userId}:${scope.role}:${scope.contextId}:${scope.route}:${slot}`
    : "invalid";

  useLayoutEffect(() => {
    if (!privateStateAccessAllowed || !storage || !scope) return;
    const draft = readRuntimeTextDraft(storage, {
      slot,
      userId: identity.userId,
      contextId: resolvedContextId,
      route,
      resourceId,
    });
    setBody(draft?.body ?? "");
  }, [
    identity.userId,
    privateStateAccessAllowed,
    resolvedContextId,
    resourceId,
    route,
    scope,
    scopeKey,
    slot,
    storage,
  ]);

  useEffect(() => {
    if (!privateStateAccessAllowed || !storage || !scope || body.trim().length === 0) return;
    const timeout = window.setTimeout(() => {
      writeRuntimeTextDraft(storage, {
        slot,
        userId: identity.userId,
        contextId: resolvedContextId,
        route,
        resourceId,
        body,
      });
    }, 250);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    body,
    identity.userId,
    privateStateAccessAllowed,
    resolvedContextId,
    resourceId,
    route,
    scope,
    scopeKey,
    slot,
    storage,
  ]);

  return {
    body,
    setBody,
    preserveDraft(nextBody = body) {
      if (!privateStateAccessAllowed || !storage || !scope || nextBody.trim().length === 0) return;
      writeRuntimeTextDraft(storage, {
        slot,
        userId: identity.userId,
        contextId: resolvedContextId,
        route,
        resourceId,
        body: nextBody,
      });
    },
    clearDraft() {
      if (!privateStateAccessAllowed || !storage || !scope) return;
      clearRuntimeTextDraft(storage, {
        slot,
        userId: identity.userId,
        contextId: resolvedContextId,
        route,
      });
    },
  };
}

export function useProducerDisplayNameDraft({
  value,
  savedValue,
  onRestore,
}: {
  value: string;
  savedValue: string;
  onRestore: (draft: ProducerDisplayNameDraft) => void;
}) {
  const { identity, privateStateAccessAllowed, storage } = useRuntimeState();
  const restore = useRef(onRestore);
  const restoredDraft = useRef(false);
  restore.current = onRestore;

  useLayoutEffect(() => {
    if (!privateStateAccessAllowed || !storage || identity.role !== "producer") return;
    const draft = readProducerDisplayNameDraft(storage, identity.userId, identity.contextId);
    if (draft && draft.displayName !== savedValue) {
      restoredDraft.current = true;
      restore.current(draft);
    }
  }, [
    identity.contextId,
    identity.role,
    identity.userId,
    privateStateAccessAllowed,
    savedValue,
    storage,
  ]);

  useEffect(() => {
    if (!privateStateAccessAllowed || !storage || identity.role !== "producer") return;
    if (value === savedValue) {
      if (restoredDraft.current) return;
      clearProducerDisplayNameDraft(storage, identity.userId, identity.contextId);
      return;
    }
    restoredDraft.current = false;
    const timeout = window.setTimeout(() => {
      writeProducerDisplayNameDraft(storage, identity.userId, identity.contextId, value);
    }, 250);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    identity.contextId,
    identity.role,
    identity.userId,
    privateStateAccessAllowed,
    savedValue,
    storage,
    value,
  ]);

  return {
    clearDraft() {
      if (!privateStateAccessAllowed || !storage || identity.role !== "producer") return;
      clearProducerDisplayNameDraft(storage, identity.userId, identity.contextId);
    },
  };
}

// Type-only exports keep callers explicit about the only two view payloads
// currently approved for persistence.
export type RuntimeSafeView = ProducerOverviewSafeView | ArtistHomeSafeView;
export type ApprovedRuntimeSlot = RuntimeSlot;
