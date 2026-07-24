import {
  RUNTIME_ROUTE_LIMIT,
  type RuntimeNavigationIndex,
  type RuntimeNavigationSnapshot,
  type RuntimeRole,
  type StorageLike,
  normalizeRuntimeHref,
  pruneRuntimeStateSlot,
  readRuntimeState,
  removeRuntimeState,
  runtimeScope,
  writeRuntimeState,
} from "./runtime-state";

export interface RuntimeIdentity {
  userId: string;
  role: RuntimeRole;
  contextId: string;
}

function roleRoot(role: RuntimeRole): string {
  return role === "producer" ? "/dashboard" : "/artist";
}

function indexScope(identity: RuntimeIdentity) {
  return runtimeScope(identity.userId, identity.role, identity.contextId, roleRoot(identity.role));
}

function snapshotScope(identity: RuntimeIdentity, href: string) {
  return runtimeScope(identity.userId, identity.role, identity.contextId, href);
}

export function runtimeFiltersForHref(
  href: string,
  role: RuntimeRole,
): RuntimeNavigationSnapshot["filters"] {
  const safeHref = normalizeRuntimeHref(href, role);
  if (!safeHref) return [];
  const url = new URL(safeHref, "https://runtime.skitza.invalid");
  return Array.from(url.searchParams, ([key, value]) => ({ key, value }));
}

export function readRuntimeNavigationIndex(
  storage: StorageLike,
  identity: RuntimeIdentity,
  now = Date.now(),
): RuntimeNavigationIndex | null {
  const scope = indexScope(identity);
  return scope ? readRuntimeState(storage, scope, "runtime.navigation.index", now) : null;
}

export function readRuntimeNavigationSnapshot(
  storage: StorageLike,
  identity: RuntimeIdentity,
  href: string,
  now = Date.now(),
): RuntimeNavigationSnapshot | null {
  const safeHref = normalizeRuntimeHref(href, identity.role);
  const scope = safeHref ? snapshotScope(identity, safeHref) : null;
  if (!scope) return null;
  const snapshot = readRuntimeState(storage, scope, "runtime.navigation.snapshot", now);
  return snapshot?.href === safeHref ? snapshot : null;
}

export function recordRuntimeNavigation(
  storage: StorageLike,
  identity: RuntimeIdentity,
  href: string,
  scrollTop: number,
  now = Date.now(),
): boolean {
  const safeHref = normalizeRuntimeHref(href, identity.role);
  const scope = safeHref ? snapshotScope(identity, safeHref) : null;
  const rootScope = indexScope(identity);
  if (!safeHref || !scope || !rootScope) return false;

  const previous = readRuntimeState(storage, rootScope, "runtime.navigation.index", now);
  const boundedScrollTop = Math.max(0, Math.min(100_000_000, Math.round(scrollTop)));
  const snapshot: RuntimeNavigationSnapshot = {
    href: safeHref,
    scrollTop: boundedScrollTop,
    filters: runtimeFiltersForHref(safeHref, identity.role),
  };
  if (!writeRuntimeState(storage, scope, "runtime.navigation.snapshot", snapshot, now))
    return false;

  const recentRoutes = [
    safeHref,
    ...(previous?.recentRoutes ?? []).filter((route) => route !== safeHref),
  ].slice(0, RUNTIME_ROUTE_LIMIT);
  const evictedRoutes = (previous?.recentRoutes ?? []).filter(
    (route) => !recentRoutes.includes(route),
  );

  const backStack =
    previous?.lastHref && previous.lastHref !== safeHref
      ? [...previous.backStack, previous.lastHref].slice(-RUNTIME_ROUTE_LIMIT)
      : (previous?.backStack ?? []);

  const index: RuntimeNavigationIndex = {
    lastHref: safeHref,
    backStack,
    recentRoutes,
  };
  if (!writeRuntimeState(storage, rootScope, "runtime.navigation.index", index, now)) return false;

  const recentScopes = recentRoutes.flatMap((route) => {
    const recentScope = snapshotScope(identity, route);
    return recentScope ? [recentScope] : [];
  });
  pruneRuntimeStateSlot(storage, identity, "runtime.navigation.snapshot", recentScopes);

  // Keep the explicit removal readable for storage implementations whose key
  // iteration is non-standard.
  for (const evictedHref of evictedRoutes) {
    const evictedScope = snapshotScope(identity, evictedHref);
    if (evictedScope) removeRuntimeState(storage, evictedScope, "runtime.navigation.snapshot");
  }
  return true;
}

export function readRuntimeResumeHref(
  storage: StorageLike,
  identity: RuntimeIdentity,
  now = Date.now(),
): string | null {
  const index = readRuntimeNavigationIndex(storage, identity, now);
  return index ? normalizeRuntimeHref(index.lastHref, identity.role) : null;
}

export function popRuntimeBack(
  storage: StorageLike,
  identity: RuntimeIdentity,
  now = Date.now(),
): string | null {
  const scope = indexScope(identity);
  if (!scope) return null;
  const index = readRuntimeState(storage, scope, "runtime.navigation.index", now);
  if (!index || index.backStack.length === 0) return null;

  const target = index.backStack[index.backStack.length - 1];
  const safeTarget = target ? normalizeRuntimeHref(target, identity.role) : null;
  if (!safeTarget) return null;

  writeRuntimeState(
    storage,
    scope,
    "runtime.navigation.index",
    {
      lastHref: safeTarget,
      backStack: index.backStack.slice(0, -1),
      recentRoutes: [
        safeTarget,
        ...index.recentRoutes.filter((route) => route !== safeTarget),
      ].slice(0, RUNTIME_ROUTE_LIMIT),
    },
    now,
  );
  return safeTarget;
}
