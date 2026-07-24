export const RUNTIME_STATE_SCHEMA_VERSION = 1 as const;
export const RUNTIME_VIEW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const RUNTIME_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const RUNTIME_ROUTE_LIMIT = 20;

const KEY_NAMESPACE = "skitza:runtime";

export type RuntimeRole = "producer" | "artist";

export interface RuntimeScope {
  userId: string;
  role: RuntimeRole;
  contextId: string;
  route: string;
}

export interface ProducerOverviewSafeView {
  displayName: string | null;
  activeProjects: number;
}

export interface ArtistHomeSafeView {
  firstName: string;
  studios: Array<{
    producerId: string;
    producerName: string;
    producerSlug: string;
  }>;
}

export interface ProducerDisplayNameDraft {
  displayName: string;
}

export interface RuntimeTextDraft {
  resourceId: string;
  body: string;
}

export interface RuntimeNavigationSnapshot {
  href: string;
  scrollTop: number;
  filters: Array<{
    key: string;
    value: string;
  }>;
}

export interface RuntimeNavigationIndex {
  lastHref: string;
  backStack: string[];
  recentRoutes: string[];
}

export interface RuntimePayloadBySlot {
  "producer.overview.safe-view": ProducerOverviewSafeView;
  "artist.home.safe-view": ArtistHomeSafeView;
  "producer.settings.display-name-draft": ProducerDisplayNameDraft;
  "producer.song-comment-draft": RuntimeTextDraft;
  "artist.song-comment-draft": RuntimeTextDraft;
  "runtime.navigation.snapshot": RuntimeNavigationSnapshot;
  "runtime.navigation.index": RuntimeNavigationIndex;
}

export type RuntimeSlot = keyof RuntimePayloadBySlot;

export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface RuntimeEnvelope<T> {
  schemaVersion: typeof RUNTIME_STATE_SCHEMA_VERSION;
  scope: RuntimeScope;
  slot: RuntimeSlot;
  updatedAt: number;
  payload: T;
}

const SLOT_MAX_AGE_MS: Record<RuntimeSlot, number> = {
  "producer.overview.safe-view": RUNTIME_VIEW_MAX_AGE_MS,
  "artist.home.safe-view": RUNTIME_VIEW_MAX_AGE_MS,
  "producer.settings.display-name-draft": RUNTIME_DRAFT_MAX_AGE_MS,
  "producer.song-comment-draft": RUNTIME_DRAFT_MAX_AGE_MS,
  "artist.song-comment-draft": RUNTIME_DRAFT_MAX_AGE_MS,
  "runtime.navigation.snapshot": RUNTIME_VIEW_MAX_AGE_MS,
  "runtime.navigation.index": RUNTIME_VIEW_MAX_AGE_MS,
};

const PRODUCER_QUERY_ALLOWLIST = new Set([
  "filter",
  "page",
  "search",
  "section",
  "sort",
  "stage",
  "status",
  "tab",
  "view",
]);

const ARTIST_QUERY_ALLOWLIST = new Set([
  "filter",
  "page",
  "search",
  "sort",
  "status",
  "studio",
  "tab",
  "view",
]);

const BLOCKED_ROUTE_PREFIXES = [
  "/api",
  "/sign-in",
  "/sign-up",
  "/dashboard/calendar",
  "/dashboard/payments",
  "/artist/book",
  "/artist/payments",
  "/artist/purchase",
  "/artist/sessions",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isBoundedString(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    (allowEmpty || value.trim().length > 0)
  );
}

function isSafeInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}

function isRuntimeRole(value: unknown): value is RuntimeRole {
  return value === "producer" || value === "artist";
}

function isRuntimeScope(value: unknown): value is RuntimeScope {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["userId", "role", "contextId", "route"]) &&
    isBoundedString(value.userId, 512) &&
    isRuntimeRole(value.role) &&
    isBoundedString(value.contextId, 512) &&
    isBoundedString(value.route, 1024) &&
    normalizeRuntimeHref(value.route, value.role) === value.route
  );
}

function matchesScope(left: RuntimeScope, right: RuntimeScope): boolean {
  return (
    left.userId === right.userId &&
    left.role === right.role &&
    left.contextId === right.contextId &&
    left.route === right.route
  );
}

function isProducerOverviewSafeView(value: unknown): value is ProducerOverviewSafeView {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["displayName", "activeProjects"]) &&
    (value.displayName === null || isBoundedString(value.displayName, 80, true)) &&
    isSafeInteger(value.activeProjects, 0, 1_000_000)
  );
}

function isArtistStudio(value: unknown): value is ArtistHomeSafeView["studios"][number] {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["producerId", "producerName", "producerSlug"]) &&
    isBoundedString(value.producerId, 128) &&
    isBoundedString(value.producerName, 120) &&
    isBoundedString(value.producerSlug, 80)
  );
}

function isArtistHomeSafeView(value: unknown): value is ArtistHomeSafeView {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["firstName", "studios"]) &&
    isBoundedString(value.firstName, 80) &&
    Array.isArray(value.studios) &&
    value.studios.length <= 100 &&
    value.studios.every(isArtistStudio)
  );
}

function isProducerDisplayNameDraft(value: unknown): value is ProducerDisplayNameDraft {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["displayName"]) &&
    isBoundedString(value.displayName, 80, true)
  );
}

function isRuntimeTextDraft(value: unknown): value is RuntimeTextDraft {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["resourceId", "body"]) &&
    isBoundedString(value.resourceId, 128) &&
    isBoundedString(value.body, 2000)
  );
}

function isRuntimeFilter(value: unknown): value is RuntimeNavigationSnapshot["filters"][number] {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["key", "value"]) &&
    isBoundedString(value.key, 40) &&
    isBoundedString(value.value, 120, true)
  );
}

function isRuntimeNavigationSnapshot(value: unknown): value is RuntimeNavigationSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["href", "scrollTop", "filters"]) ||
    !isBoundedString(value.href, 1024) ||
    !isSafeInteger(value.scrollTop, 0, 100_000_000) ||
    !Array.isArray(value.filters) ||
    value.filters.length > 30 ||
    !value.filters.every(isRuntimeFilter)
  ) {
    return false;
  }
  return value.href === normalizeRuntimeHref(value.href, runtimeRoleForHref(value.href));
}

function isRuntimeNavigationIndex(value: unknown): value is RuntimeNavigationIndex {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["lastHref", "backStack", "recentRoutes"]) &&
    isBoundedString(value.lastHref, 1024) &&
    Array.isArray(value.backStack) &&
    value.backStack.length <= RUNTIME_ROUTE_LIMIT &&
    value.backStack.every((href) => isBoundedString(href, 1024)) &&
    Array.isArray(value.recentRoutes) &&
    value.recentRoutes.length <= RUNTIME_ROUTE_LIMIT &&
    value.recentRoutes.every((href) => isBoundedString(href, 1024))
  );
}

const SLOT_VALIDATORS: {
  [Slot in RuntimeSlot]: (value: unknown) => value is RuntimePayloadBySlot[Slot];
} = {
  "producer.overview.safe-view": isProducerOverviewSafeView,
  "artist.home.safe-view": isArtistHomeSafeView,
  "producer.settings.display-name-draft": isProducerDisplayNameDraft,
  "producer.song-comment-draft": isRuntimeTextDraft,
  "artist.song-comment-draft": isRuntimeTextDraft,
  "runtime.navigation.snapshot": isRuntimeNavigationSnapshot,
  "runtime.navigation.index": isRuntimeNavigationIndex,
};

export function isRuntimeSlot(value: string): value is RuntimeSlot {
  return Object.prototype.hasOwnProperty.call(SLOT_VALIDATORS, value);
}

function isBlockedRoute(pathname: string): boolean {
  return BLOCKED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function runtimeRoleForHref(href: string): RuntimeRole {
  return href === "/artist" || href.startsWith("/artist?") || href.startsWith("/artist/")
    ? "artist"
    : "producer";
}

/**
 * Returns a canonical, same-origin, role-owned href with only explicitly
 * approved UI filters. Transactional/auth routes are rejected. Music route
 * metadata may be restored, but no audio or signed-delivery payload slot is
 * allowlisted.
 */
export function normalizeRuntimeHref(href: string, role: RuntimeRole): string | null {
  if (!href.startsWith("/") || href.startsWith("//") || href.length > 1024) return null;

  let url: URL;
  try {
    url = new URL(href, "https://runtime.skitza.invalid");
  } catch {
    return null;
  }

  const roleRoot = role === "producer" ? "/dashboard" : "/artist";
  if (!(url.pathname === roleRoot || url.pathname.startsWith(`${roleRoot}/`))) return null;
  if (isBlockedRoute(url.pathname)) return null;

  const allowedQuery = role === "producer" ? PRODUCER_QUERY_ALLOWLIST : ARTIST_QUERY_ALLOWLIST;
  const safeSearch = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (allowedQuery.has(key) && key.length <= 40 && value.length <= 120 && safeSearch.size < 30) {
      safeSearch.append(key, value);
    }
  }
  safeSearch.sort();

  const query = safeSearch.toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

export function runtimeScope(
  userId: string,
  role: RuntimeRole,
  contextId: string,
  href: string,
): RuntimeScope | null {
  const route = normalizeRuntimeHref(href, role);
  if (!route) return null;
  const scope = { userId, role, contextId, route };
  return isRuntimeScope(scope) ? scope : null;
}

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value);
}

function userStoragePrefix(userId: string): string {
  return `${KEY_NAMESPACE}:user=${encodeKeyPart(userId)}:`;
}

export function buildRuntimeStorageKey(scope: RuntimeScope, slot: RuntimeSlot): string {
  if (!isRuntimeScope(scope) || !isRuntimeSlot(slot) || !isSlotAllowedForScope(scope, slot)) {
    throw new Error("Invalid runtime-state scope or slot.");
  }
  return [
    userStoragePrefix(scope.userId).slice(0, -1),
    `schema=${String(RUNTIME_STATE_SCHEMA_VERSION)}`,
    `role=${scope.role}`,
    `context=${encodeKeyPart(scope.contextId)}`,
    `route=${encodeKeyPart(scope.route)}`,
    `slot=${encodeKeyPart(slot)}`,
  ].join(":");
}

function pathnameForScope(scope: RuntimeScope): string {
  return new URL(scope.route, "https://runtime.skitza.invalid").pathname;
}

function isSongCommentDraftRoute(pathname: string, role: RuntimeRole): boolean {
  const pattern =
    role === "producer" ? /^\/dashboard\/music\/[^/]+$/ : /^\/artist\/music\/song\/[^/]+$/;
  return pattern.test(pathname);
}

function isSlotAllowedForScope(scope: RuntimeScope, slot: RuntimeSlot): boolean {
  const pathname = pathnameForScope(scope);
  switch (slot) {
    case "producer.overview.safe-view":
      return scope.role === "producer" && pathname === "/dashboard";
    case "artist.home.safe-view":
      return scope.role === "artist" && pathname === "/artist";
    case "producer.settings.display-name-draft":
      return scope.role === "producer" && scope.route === "/dashboard/settings?section=profile";
    case "producer.song-comment-draft":
      return scope.role === "producer" && isSongCommentDraftRoute(pathname, scope.role);
    case "artist.song-comment-draft":
      return scope.role === "artist" && isSongCommentDraftRoute(pathname, scope.role);
    case "runtime.navigation.snapshot":
      return true;
    case "runtime.navigation.index":
      return scope.route === (scope.role === "producer" ? "/dashboard" : "/artist");
  }
}

function navigationPayloadMatchesScope(
  scope: RuntimeScope,
  slot: RuntimeSlot,
  payload: unknown,
): boolean {
  if (slot === "runtime.navigation.snapshot") {
    if (!isRuntimeNavigationSnapshot(payload) || payload.href !== scope.route) {
      return false;
    }
    const expectedFilters = Array.from(
      new URL(scope.route, "https://runtime.skitza.invalid").searchParams,
      ([key, value]) => ({ key, value }),
    );
    return JSON.stringify(payload.filters) === JSON.stringify(expectedFilters);
  }
  if (slot === "runtime.navigation.index") {
    if (!isRuntimeNavigationIndex(payload)) return false;
    return [payload.lastHref, ...payload.backStack, ...payload.recentRoutes].every(
      (href) => normalizeRuntimeHref(href, scope.role) === href,
    );
  }
  return true;
}

function isRuntimeEnvelope<Slot extends RuntimeSlot>(
  value: unknown,
  scope: RuntimeScope,
  slot: Slot,
): value is RuntimeEnvelope<RuntimePayloadBySlot[Slot]> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "scope", "slot", "updatedAt", "payload"]) ||
    value.schemaVersion !== RUNTIME_STATE_SCHEMA_VERSION ||
    value.slot !== slot ||
    !isRuntimeScope(value.scope) ||
    !matchesScope(value.scope, scope) ||
    !isSafeInteger(value.updatedAt, 0) ||
    !SLOT_VALIDATORS[slot](value.payload) ||
    !isSlotAllowedForScope(scope, slot) ||
    !navigationPayloadMatchesScope(scope, slot, value.payload)
  ) {
    return false;
  }
  return true;
}

function safelyRemoveStorageItem(storage: StorageLike, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Runtime persistence is progressive enhancement in restricted storage.
  }
}

export function readRuntimeState<Slot extends RuntimeSlot>(
  storage: StorageLike,
  scope: RuntimeScope,
  slot: Slot,
  now = Date.now(),
): RuntimePayloadBySlot[Slot] | null {
  let key: string;
  try {
    key = buildRuntimeStorageKey(scope, slot);
  } catch {
    return null;
  }

  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRuntimeEnvelope(parsed, scope, slot)) {
      safelyRemoveStorageItem(storage, key);
      return null;
    }
    if (now - parsed.updatedAt > SLOT_MAX_AGE_MS[slot] || parsed.updatedAt > now + 60_000) {
      safelyRemoveStorageItem(storage, key);
      return null;
    }
    return parsed.payload;
  } catch {
    safelyRemoveStorageItem(storage, key);
    return null;
  }
}

export function writeRuntimeState<Slot extends RuntimeSlot>(
  storage: StorageLike,
  scope: RuntimeScope,
  slot: Slot,
  payload: RuntimePayloadBySlot[Slot],
  now = Date.now(),
): boolean {
  if (
    !isRuntimeScope(scope) ||
    !SLOT_VALIDATORS[slot](payload) ||
    !isSlotAllowedForScope(scope, slot) ||
    !navigationPayloadMatchesScope(scope, slot, payload)
  ) {
    return false;
  }

  try {
    const envelope: RuntimeEnvelope<RuntimePayloadBySlot[Slot]> = {
      schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
      scope,
      slot,
      updatedAt: now,
      payload,
    };
    storage.setItem(buildRuntimeStorageKey(scope, slot), JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export function removeRuntimeState(
  storage: StorageLike,
  scope: RuntimeScope,
  slot: RuntimeSlot,
): void {
  try {
    safelyRemoveStorageItem(storage, buildRuntimeStorageKey(scope, slot));
  } catch {
    // Invalid scopes never get a storage key, so there is nothing to remove.
  }
}

export function pruneRuntimeStateSlot(
  storage: StorageLike,
  identity: Pick<RuntimeScope, "userId" | "role" | "contextId">,
  slot: RuntimeSlot,
  keepScopes: RuntimeScope[],
): number {
  const identityPrefix = [
    userStoragePrefix(identity.userId).slice(0, -1),
    `schema=${String(RUNTIME_STATE_SCHEMA_VERSION)}`,
    `role=${identity.role}`,
    `context=${encodeKeyPart(identity.contextId)}`,
  ].join(":");
  const slotSuffix = `:slot=${encodeKeyPart(slot)}`;
  const keepKeys = new Set<string>();
  for (const scope of keepScopes) {
    try {
      keepKeys.add(buildRuntimeStorageKey(scope, slot));
    } catch {
      // Invalid keep scopes cannot identify persisted state.
    }
  }

  const removeKeys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(`${identityPrefix}:`) && key.endsWith(slotSuffix) && !keepKeys.has(key)) {
        removeKeys.push(key);
      }
    }
  } catch {
    return 0;
  }
  for (const key of removeKeys) safelyRemoveStorageItem(storage, key);
  return removeKeys.length;
}

/**
 * Clears every schema version owned by one Clerk user synchronously. Keys for
 * other users remain untouched.
 */
export function clearRuntimeStateForUser(storage: StorageLike, userId: string): number {
  const prefix = userStoragePrefix(userId);
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch {
    return 0;
  }
  for (const key of keys) safelyRemoveStorageItem(storage, key);
  return keys.length;
}

export function getBrowserRuntimeStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    void storage.length;
    return storage;
  } catch {
    return null;
  }
}
