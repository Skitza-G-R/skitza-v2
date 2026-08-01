export const RUNTIME_STATE_SCHEMA_VERSION = 1 as const;
export const RUNTIME_VIEW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const RUNTIME_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const RUNTIME_ROUTE_LIMIT = 20;
export const ARTIST_CONTEXT_POINTER_CONTEXT_ID = "artist-account";
export const RUNTIME_LAUNCH_CONTEXT_ID = "runtime-launch";
export const RUNTIME_SCREEN_MAX_METRICS = 4;
export const RUNTIME_SCREEN_MAX_SECTIONS = 3;
export const RUNTIME_SCREEN_MAX_ITEMS_PER_SECTION = 40;
export const RUNTIME_SCREEN_MAX_ITEMS = 80;
export const RUNTIME_SCREEN_KEY_MAX_LENGTH = 160;
export const RUNTIME_SCREEN_LABEL_MAX_LENGTH = 120;
export const RUNTIME_SCREEN_TITLE_MAX_LENGTH = 200;
export const RUNTIME_SCREEN_DETAIL_MAX_LENGTH = 300;

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

export interface ArtistStudioContextPointer {
  studioId: string;
}

export interface ProducerWorkspaceSafeView {
  clientCount: number;
  projectCount: number;
  needsAttentionCount: number;
}

export interface ProducerMusicSafeView {
  projectCount: number;
  songCount: number;
  archivedSongCount: number;
}

export interface ProducerStoreSafeView {
  productCount: number;
  liveProductCount: number;
}

export interface ProducerPortfolioSafeView {
  publishedCount: number;
  availableCount: number;
}

export type ProducerStoreDraftStep =
  | "type"
  | "details"
  | "price"
  | "payment"
  | "delivery"
  | "rights"
  | "review";

export interface ProducerStoreProductDraft {
  open: true;
  mode: "new" | "edit";
  productId: string | null;
  currentStep: ProducerStoreDraftStep;
  draft: {
    _picked: "production" | "mix" | "master" | "blank" | null;
    _legacyAgreementLink: boolean;
    name: string;
    tagline: string;
    type: "production" | "mix" | "master" | "consult";
    price: number;
    currency: "USD" | "EUR" | "GBP" | "ILS";
    /** Added in SK-155. Missing only on drafts saved by older clients. */
    includesSessions?: boolean;
    sessions: number;
    unlimitedSessions: boolean;
    /** Added by the artist-platform release. Missing only on older saved drafts. */
    bookingEnabled?: boolean;
    payment: {
      full: boolean;
      split50: boolean;
      monthly: boolean;
      monthlyInstallments: number;
    };
    includes: string[];
    duration: string;
    revisions: number;
    unlimitedRevisions: boolean;
    agreementMode: "none" | "text";
    agreementText: string;
    royalty: {
      masterMode: "none" | "percentage" | "agreement" | null;
      masterPercentage: string;
      compositionMode: "none" | "percentage" | "agreement" | null;
      compositionPercentage: string;
      compositionRole: "composer" | "lyricist" | "arranger" | "publisher" | "other" | "";
      collectingSociety: string;
      notes: string;
    };
    pricingModel: "flat" | "per_song";
    volumeTiers: Array<{
      minQty: number;
      pricePerUnitCents: number;
    }>;
  };
}

export interface ArtistMusicSafeView {
  mode: "projects" | "songs";
  view: "grid" | "table";
  search: string;
  sort: "recent" | "title" | "notes" | "length";
  archive: "active" | "archived";
  projectCount: number;
  songCount: number;
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

export type RuntimeScreenSafeViewKind =
  | "producer-overview"
  | "producer-workspace"
  | "producer-music"
  | "artist-home"
  | "artist-music"
  | "artist-store";

export interface RuntimeScreenSafeView {
  kind: RuntimeScreenSafeViewKind;
  title: string;
  subtitle: string | null;
  metrics: Array<{
    label: string;
    value: string;
  }>;
  sections: Array<{
    label: string;
    items: Array<{
      key: string;
      title: string;
      detail: string | null;
      badge: string | null;
    }>;
  }>;
}

export interface RuntimeLaunchPointer {
  contextId: string;
  href: string;
}

export interface RuntimeLaunchTarget extends RuntimeLaunchPointer {
  role: RuntimeRole;
}

export type RuntimeStateIdentity = Pick<
  RuntimeScope,
  "userId" | "role" | "contextId"
>;

export interface RuntimePayloadBySlot {
  "producer.overview.safe-view": ProducerOverviewSafeView;
  "producer.workspace.safe-view": ProducerWorkspaceSafeView;
  "producer.music.safe-view": ProducerMusicSafeView;
  "producer.store.safe-view": ProducerStoreSafeView;
  "producer.portfolio.safe-view": ProducerPortfolioSafeView;
  "artist.home.safe-view": ArtistHomeSafeView;
  "artist.music.safe-view": ArtistMusicSafeView;
  "artist.last-studio-context": ArtistStudioContextPointer;
  "producer.settings.display-name-draft": ProducerDisplayNameDraft;
  "producer.store.product-draft": ProducerStoreProductDraft;
  "producer.song-comment-draft": RuntimeTextDraft;
  "artist.song-comment-draft": RuntimeTextDraft;
  "runtime.navigation.snapshot": RuntimeNavigationSnapshot;
  "runtime.navigation.index": RuntimeNavigationIndex;
  "runtime.screen.safe-view": RuntimeScreenSafeView;
  "runtime.launch.pointer": RuntimeLaunchPointer;
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
  "producer.workspace.safe-view": RUNTIME_VIEW_MAX_AGE_MS,
  "producer.music.safe-view": RUNTIME_VIEW_MAX_AGE_MS,
  "producer.store.safe-view": RUNTIME_VIEW_MAX_AGE_MS,
  "producer.portfolio.safe-view": RUNTIME_VIEW_MAX_AGE_MS,
  "artist.home.safe-view": RUNTIME_VIEW_MAX_AGE_MS,
  "artist.music.safe-view": RUNTIME_VIEW_MAX_AGE_MS,
  "artist.last-studio-context": RUNTIME_VIEW_MAX_AGE_MS,
  "producer.settings.display-name-draft": RUNTIME_DRAFT_MAX_AGE_MS,
  "producer.store.product-draft": RUNTIME_DRAFT_MAX_AGE_MS,
  "producer.song-comment-draft": RUNTIME_DRAFT_MAX_AGE_MS,
  "artist.song-comment-draft": RUNTIME_DRAFT_MAX_AGE_MS,
  "runtime.navigation.snapshot": RUNTIME_VIEW_MAX_AGE_MS,
  "runtime.navigation.index": RUNTIME_VIEW_MAX_AGE_MS,
  "runtime.screen.safe-view": RUNTIME_VIEW_MAX_AGE_MS,
  "runtime.launch.pointer": RUNTIME_VIEW_MAX_AGE_MS,
};

const LIVE_ONLY_ARTIST_ROUTE_PREFIXES = [
  "/artist/book",
  "/artist/offers",
  "/artist/payments",
  "/artist/purchase",
  "/artist/sessions",
  "/artist/music/no-charge",
] as const;

const SAFE_ID_SEGMENT = "[A-Za-z0-9_-]{1,128}";

const PRODUCER_ROUTE_PATTERNS = [
  /^\/dashboard$/,
  /^\/dashboard\/calendar$/,
  /^\/dashboard\/clients-projects$/,
  /^\/dashboard\/clients-projects\/new$/,
  new RegExp(`^/dashboard/clients-projects/(?!new$|clients$)${SAFE_ID_SEGMENT}$`),
  new RegExp(`^/dashboard/clients-projects/${SAFE_ID_SEGMENT}/songs/${SAFE_ID_SEGMENT}$`),
  new RegExp(`^/dashboard/clients-projects/clients/${SAFE_ID_SEGMENT}$`),
  /^\/dashboard\/music$/,
  new RegExp(`^/dashboard/music/(?!project$)${SAFE_ID_SEGMENT}$`),
  new RegExp(`^/dashboard/music/project/${SAFE_ID_SEGMENT}$`),
  /^\/dashboard\/onboarding$/,
  /^\/dashboard\/payments$/,
  new RegExp(`^/dashboard/payments/${SAFE_ID_SEGMENT}$`),
  /^\/dashboard\/portfolio$/,
  /^\/dashboard\/profile$/,
  /^\/dashboard\/requests$/,
  new RegExp(`^/dashboard/requests/${SAFE_ID_SEGMENT}$`),
  /^\/dashboard\/settings$/,
  /^\/dashboard\/store$/,
] as const;

const ARTIST_ROUTE_PATTERNS = [
  /^\/artist$/,
  /^\/artist\/music$/,
  new RegExp(`^/artist/music/(?!song$|no-charge$)${SAFE_ID_SEGMENT}$`),
  new RegExp(`^/artist/music/song/${SAFE_ID_SEGMENT}$`),
  /^\/artist\/store$/,
  /^\/artist\/settings$/,
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

function isFiniteNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
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

function isArtistStudioContextPointer(
  value: unknown,
): value is ArtistStudioContextPointer {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["studioId"]) &&
    isBoundedString(value.studioId, 128)
  );
}

function isProducerWorkspaceSafeView(value: unknown): value is ProducerWorkspaceSafeView {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["clientCount", "projectCount", "needsAttentionCount"]) &&
    isSafeInteger(value.clientCount, 0, 1_000_000) &&
    isSafeInteger(value.projectCount, 0, 1_000_000) &&
    isSafeInteger(value.needsAttentionCount, 0, 1_000_000)
  );
}

function isProducerMusicSafeView(value: unknown): value is ProducerMusicSafeView {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["projectCount", "songCount", "archivedSongCount"]) &&
    isSafeInteger(value.projectCount, 0, 1_000_000) &&
    isSafeInteger(value.songCount, 0, 1_000_000) &&
    isSafeInteger(value.archivedSongCount, 0, 1_000_000)
  );
}

function isProducerStoreSafeView(value: unknown): value is ProducerStoreSafeView {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["productCount", "liveProductCount"]) &&
    isSafeInteger(value.productCount, 0, 1_000_000) &&
    isSafeInteger(value.liveProductCount, 0, 1_000_000)
  );
}

function isProducerPortfolioSafeView(value: unknown): value is ProducerPortfolioSafeView {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["publishedCount", "availableCount"]) &&
    isSafeInteger(value.publishedCount, 0, 1_000_000) &&
    isSafeInteger(value.availableCount, 0, 1_000_000)
  );
}

function isArtistMusicSafeView(value: unknown): value is ArtistMusicSafeView {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "mode",
      "view",
      "search",
      "sort",
      "archive",
      "projectCount",
      "songCount",
    ]) &&
    (value.mode === "projects" || value.mode === "songs") &&
    (value.view === "grid" || value.view === "table") &&
    isBoundedString(value.search, 120, true) &&
    (value.sort === "recent" ||
      value.sort === "title" ||
      value.sort === "notes" ||
      value.sort === "length") &&
    (value.archive === "active" || value.archive === "archived") &&
    isSafeInteger(value.projectCount, 0, 1_000_000) &&
    isSafeInteger(value.songCount, 0, 1_000_000)
  );
}

function isProducerDisplayNameDraft(value: unknown): value is ProducerDisplayNameDraft {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["displayName"]) &&
    isBoundedString(value.displayName, 80, true)
  );
}

function isProducerStorePaymentDraft(
  value: unknown,
): value is ProducerStoreProductDraft["draft"]["payment"] {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["full", "split50", "monthly", "monthlyInstallments"]) &&
    typeof value.full === "boolean" &&
    typeof value.split50 === "boolean" &&
    typeof value.monthly === "boolean" &&
    isSafeInteger(value.monthlyInstallments, 0, 100)
  );
}

function isProducerStoreRoyaltyDraft(
  value: unknown,
): value is ProducerStoreProductDraft["draft"]["royalty"] {
  const modes = ["none", "percentage", "agreement", null] as const;
  const roles = ["composer", "lyricist", "arranger", "publisher", "other", ""] as const;
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "masterMode",
      "masterPercentage",
      "compositionMode",
      "compositionPercentage",
      "compositionRole",
      "collectingSociety",
      "notes",
    ]) &&
    modes.includes(value.masterMode as (typeof modes)[number]) &&
    isBoundedString(value.masterPercentage, 16, true) &&
    modes.includes(value.compositionMode as (typeof modes)[number]) &&
    isBoundedString(value.compositionPercentage, 16, true) &&
    roles.includes(value.compositionRole as (typeof roles)[number]) &&
    isBoundedString(value.collectingSociety, 200, true) &&
    isBoundedString(value.notes, 4_000, true)
  );
}

function isProducerStoreProductDraft(value: unknown): value is ProducerStoreProductDraft {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["open", "mode", "productId", "currentStep", "draft"]) ||
    value.open !== true ||
    (value.mode !== "new" && value.mode !== "edit") ||
    (value.productId !== null && !isBoundedString(value.productId, 128)) ||
    (value.mode === "new" ? value.productId !== null : value.productId === null) ||
    !["type", "details", "price", "payment", "delivery", "rights", "review"].includes(
      String(value.currentStep),
    ) ||
    !isRecord(value.draft)
  ) {
    return false;
  }

  const currentDraftKeys = [
    "_picked",
    "_legacyAgreementLink",
    "name",
    "tagline",
    "type",
    "price",
    "currency",
    "includesSessions",
    "sessions",
    "unlimitedSessions",
    "bookingEnabled",
    "payment",
    "includes",
    "duration",
    "revisions",
    "unlimitedRevisions",
    "agreementMode",
    "agreementText",
    "royalty",
    "pricingModel",
    "volumeTiers",
  ] as const;
  const withoutIncludesSessions = currentDraftKeys.filter((key) => key !== "includesSessions");
  const withoutBookingEnabled = currentDraftKeys.filter((key) => key !== "bookingEnabled");
  const legacyDraftKeys = currentDraftKeys.filter(
    (key) => key !== "includesSessions" && key !== "bookingEnabled",
  );
  if (
    !hasExactKeys(value.draft, currentDraftKeys) &&
    !hasExactKeys(value.draft, withoutIncludesSessions) &&
    !hasExactKeys(value.draft, withoutBookingEnabled) &&
    !hasExactKeys(value.draft, legacyDraftKeys)
  ) {
    return false;
  }

  const draft = value.draft;
  const picked = ["production", "mix", "master", "blank", null] as const;
  const types = ["production", "mix", "master", "consult"] as const;
  const currencies = ["USD", "EUR", "GBP", "ILS"] as const;
  return (
    picked.includes(draft._picked as (typeof picked)[number]) &&
    typeof draft._legacyAgreementLink === "boolean" &&
    isBoundedString(draft.name, 200, true) &&
    isBoundedString(draft.tagline, 160, true) &&
    types.includes(draft.type as (typeof types)[number]) &&
    isFiniteNumber(draft.price, 0, 100_000_000) &&
    currencies.includes(draft.currency as (typeof currencies)[number]) &&
    (draft.includesSessions === undefined || typeof draft.includesSessions === "boolean") &&
    isSafeInteger(draft.sessions, 0, 10_000) &&
    typeof draft.unlimitedSessions === "boolean" &&
    (draft.bookingEnabled === undefined || typeof draft.bookingEnabled === "boolean") &&
    isProducerStorePaymentDraft(draft.payment) &&
    Array.isArray(draft.includes) &&
    draft.includes.length <= 100 &&
    draft.includes.every((item) => isBoundedString(item, 500, true)) &&
    isBoundedString(draft.duration, 80, true) &&
    isSafeInteger(draft.revisions, 0, 1_000) &&
    typeof draft.unlimitedRevisions === "boolean" &&
    (draft.agreementMode === "none" || draft.agreementMode === "text") &&
    isBoundedString(draft.agreementText, 20_000, true) &&
    isProducerStoreRoyaltyDraft(draft.royalty) &&
    (draft.pricingModel === "flat" || draft.pricingModel === "per_song") &&
    Array.isArray(draft.volumeTiers) &&
    draft.volumeTiers.length <= 10 &&
    draft.volumeTiers.every(
      (tier) =>
        isRecord(tier) &&
        hasExactKeys(tier, ["minQty", "pricePerUnitCents"]) &&
        isSafeInteger(tier.minQty, 0, 1_000) &&
        isSafeInteger(tier.pricePerUnitCents, 0, 10_000_000_000),
    )
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

function isRuntimeScreenMetric(
  value: unknown,
): value is RuntimeScreenSafeView["metrics"][number] {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["label", "value"]) &&
    isBoundedString(value.label, RUNTIME_SCREEN_LABEL_MAX_LENGTH) &&
    isBoundedString(value.value, RUNTIME_SCREEN_LABEL_MAX_LENGTH)
  );
}

function isRuntimeScreenItem(
  value: unknown,
): value is RuntimeScreenSafeView["sections"][number]["items"][number] {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["key", "title", "detail", "badge"]) &&
    isBoundedString(value.key, RUNTIME_SCREEN_KEY_MAX_LENGTH) &&
    isBoundedString(value.title, RUNTIME_SCREEN_TITLE_MAX_LENGTH) &&
    (value.detail === null ||
      isBoundedString(value.detail, RUNTIME_SCREEN_DETAIL_MAX_LENGTH)) &&
    (value.badge === null ||
      isBoundedString(value.badge, RUNTIME_SCREEN_LABEL_MAX_LENGTH))
  );
}

function isRuntimeScreenSection(
  value: unknown,
): value is RuntimeScreenSafeView["sections"][number] {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["label", "items"]) &&
    isBoundedString(value.label, RUNTIME_SCREEN_LABEL_MAX_LENGTH) &&
    Array.isArray(value.items) &&
    value.items.length <= RUNTIME_SCREEN_MAX_ITEMS_PER_SECTION &&
    value.items.every(isRuntimeScreenItem)
  );
}

function isRuntimeScreenSafeView(value: unknown): value is RuntimeScreenSafeView {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["kind", "title", "subtitle", "metrics", "sections"]) ||
    ![
      "producer-overview",
      "producer-workspace",
      "producer-music",
      "artist-home",
      "artist-music",
      "artist-store",
    ].includes(String(value.kind)) ||
    !isBoundedString(value.title, RUNTIME_SCREEN_TITLE_MAX_LENGTH) ||
    (value.subtitle !== null &&
      !isBoundedString(value.subtitle, RUNTIME_SCREEN_DETAIL_MAX_LENGTH)) ||
    !Array.isArray(value.metrics) ||
    value.metrics.length > RUNTIME_SCREEN_MAX_METRICS ||
    !value.metrics.every(isRuntimeScreenMetric) ||
    !Array.isArray(value.sections) ||
    value.sections.length > RUNTIME_SCREEN_MAX_SECTIONS ||
    !value.sections.every(isRuntimeScreenSection)
  ) {
    return false;
  }

  return (
    value.sections.reduce((total, section) => total + section.items.length, 0) <=
    RUNTIME_SCREEN_MAX_ITEMS
  );
}

function isRuntimeLaunchPointer(value: unknown): value is RuntimeLaunchPointer {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["contextId", "href"]) &&
    isBoundedString(value.contextId, 512) &&
    value.contextId !== RUNTIME_LAUNCH_CONTEXT_ID &&
    isBoundedString(value.href, 1024)
  );
}

const SLOT_VALIDATORS: {
  [Slot in RuntimeSlot]: (value: unknown) => value is RuntimePayloadBySlot[Slot];
} = {
  "producer.overview.safe-view": isProducerOverviewSafeView,
  "producer.workspace.safe-view": isProducerWorkspaceSafeView,
  "producer.music.safe-view": isProducerMusicSafeView,
  "producer.store.safe-view": isProducerStoreSafeView,
  "producer.portfolio.safe-view": isProducerPortfolioSafeView,
  "artist.home.safe-view": isArtistHomeSafeView,
  "artist.music.safe-view": isArtistMusicSafeView,
  "artist.last-studio-context": isArtistStudioContextPointer,
  "producer.settings.display-name-draft": isProducerDisplayNameDraft,
  "producer.store.product-draft": isProducerStoreProductDraft,
  "producer.song-comment-draft": isRuntimeTextDraft,
  "artist.song-comment-draft": isRuntimeTextDraft,
  "runtime.navigation.snapshot": isRuntimeNavigationSnapshot,
  "runtime.navigation.index": isRuntimeNavigationIndex,
  "runtime.screen.safe-view": isRuntimeScreenSafeView,
  "runtime.launch.pointer": isRuntimeLaunchPointer,
};

export function isRuntimeSlot(value: string): value is RuntimeSlot {
  return Object.prototype.hasOwnProperty.call(SLOT_VALIDATORS, value);
}

function isLiveOnlyArtistRoute(pathname: string): boolean {
  return LIVE_ONLY_ARTIST_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isAllowlistedRuntimePathname(pathname: string, role: RuntimeRole): boolean {
  const patterns = role === "producer" ? PRODUCER_ROUTE_PATTERNS : ARTIST_ROUTE_PATTERNS;
  return patterns.some((pattern) => pattern.test(pathname));
}

function isEnumerated(value: string, allowed: readonly string[]): boolean {
  return allowed.includes(value);
}

function isAllowedRuntimeQuery(
  pathname: string,
  role: RuntimeRole,
  key: string,
  value: string,
): boolean {
  if (key.length > 40 || value.length > 120) return false;

  if (role === "artist") {
    if (key === "studio") return value.trim().length > 0;
    if (pathname !== "/artist/music") return false;
    if (key === "mode") return isEnumerated(value, ["projects", "songs"]);
    if (key === "view") return isEnumerated(value, ["grid", "table"]);
    if (key === "search") return true;
    if (key === "sort") return isEnumerated(value, ["recent", "title", "notes", "length"]);
    if (key === "filter") return isEnumerated(value, ["active", "archived"]);
    return false;
  }

  if (pathname === "/dashboard") {
    return key === "view" && value === "all";
  }
  if (pathname === "/dashboard/calendar") {
    return key === "tab" && isEnumerated(value, ["schedule", "sessions", "availability"]);
  }
  if (pathname === "/dashboard/clients-projects") {
    if (key === "tab") return isEnumerated(value, ["clients", "projects"]);
    if (key === "filter") return isEnumerated(value, ["all", "urgent", "active", "archived"]);
    if (key === "sort") {
      return isEnumerated(value, [
        "custom",
        "recent",
        "deadline",
        "balance",
        "progress",
        "joined",
        "name",
      ]);
    }
    if (key === "view") return isEnumerated(value, ["cards", "table"]);
    return key === "search";
  }
  if (pathname === "/dashboard/music") {
    if (key === "mode") return isEnumerated(value, ["projects", "songs"]);
    if (key === "view") return isEnumerated(value, ["grid", "table"]);
    if (key === "search") return true;
    if (key === "sort") return isEnumerated(value, ["recent", "title", "notes", "length"]);
    return key === "filter" && isEnumerated(value, ["active", "archived"]);
  }
  if (pathname === "/dashboard/settings") {
    return key === "section" && isEnumerated(value, ["profile", "plan", "notif", "int", "region"]);
  }
  if (pathname === "/dashboard/store") {
    if (key === "filter") return isEnumerated(value, ["all", "live", "hidden"]);
    return key === "search";
  }
  return false;
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

  if (role === "artist" && isLiveOnlyArtistRoute(url.pathname)) return null;
  if (!isAllowlistedRuntimePathname(url.pathname, role)) return null;

  const safeSearch = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (isAllowedRuntimeQuery(url.pathname, role, key, value) && safeSearch.size < 30) {
      safeSearch.append(key, value);
    }
  }
  safeSearch.sort();

  const query = safeSearch.toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

const RUNTIME_SCREEN_KIND_BY_PATHNAME: {
  [Role in RuntimeRole]: Readonly<Partial<Record<string, RuntimeScreenSafeViewKind>>>;
} = {
  producer: {
    "/dashboard": "producer-overview",
    "/dashboard/clients-projects": "producer-workspace",
    "/dashboard/music": "producer-music",
  },
  artist: {
    "/artist": "artist-home",
    "/artist/music": "artist-music",
    "/artist/store": "artist-store",
  },
};

/**
 * Reduces an allowlisted screen href to its canonical pathname. Query state is
 * intentionally excluded so one bounded display model can cover each main
 * destination without crossing a role or studio context.
 */
export function canonicalRuntimeScreenPathname(
  href: string,
  role: RuntimeRole,
): string | null {
  const safeHref = normalizeRuntimeHref(href, role);
  if (!safeHref) return null;
  const pathname = new URL(safeHref, "https://runtime.skitza.invalid").pathname;
  return RUNTIME_SCREEN_KIND_BY_PATHNAME[role][pathname] ? pathname : null;
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
    case "producer.workspace.safe-view":
      return scope.role === "producer" && pathname === "/dashboard/clients-projects";
    case "producer.music.safe-view":
      return scope.role === "producer" && pathname === "/dashboard/music";
    case "producer.store.safe-view":
      return scope.role === "producer" && pathname === "/dashboard/store";
    case "producer.portfolio.safe-view":
      return scope.role === "producer" && pathname === "/dashboard/portfolio";
    case "artist.home.safe-view":
      return scope.role === "artist" && pathname === "/artist";
    case "artist.music.safe-view":
      return scope.role === "artist" && pathname === "/artist/music";
    case "artist.last-studio-context":
      return (
        scope.role === "artist" &&
        scope.contextId === ARTIST_CONTEXT_POINTER_CONTEXT_ID &&
        scope.route === "/artist"
      );
    case "producer.settings.display-name-draft":
      return scope.role === "producer" && scope.route === "/dashboard/settings?section=profile";
    case "producer.store.product-draft":
      return scope.role === "producer" && scope.route === "/dashboard/store";
    case "producer.song-comment-draft":
      return scope.role === "producer" && isSongCommentDraftRoute(pathname, scope.role);
    case "artist.song-comment-draft":
      return scope.role === "artist" && isSongCommentDraftRoute(pathname, scope.role);
    case "runtime.navigation.snapshot":
      return true;
    case "runtime.navigation.index":
      return scope.route === (scope.role === "producer" ? "/dashboard" : "/artist");
    case "runtime.screen.safe-view":
      return (
        scope.route === pathname &&
        RUNTIME_SCREEN_KIND_BY_PATHNAME[scope.role][pathname] !== undefined
      );
    case "runtime.launch.pointer":
      return (
        scope.contextId === RUNTIME_LAUNCH_CONTEXT_ID &&
        scope.route === (scope.role === "producer" ? "/dashboard" : "/artist")
      );
  }
}

function runtimePayloadMatchesScope(
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
  if (slot === "runtime.screen.safe-view") {
    if (!isRuntimeScreenSafeView(payload) || scope.route !== pathnameForScope(scope)) {
      return false;
    }
    return RUNTIME_SCREEN_KIND_BY_PATHNAME[scope.role][scope.route] === payload.kind;
  }
  if (slot === "runtime.launch.pointer") {
    if (!isRuntimeLaunchPointer(payload)) return false;
    const safeHref = normalizeRuntimeHref(payload.href, scope.role);
    if (safeHref !== payload.href) return false;
    if (!canonicalRuntimeScreenPathname(safeHref, scope.role)) return false;
    if (scope.role === "artist") {
      const studio = new URL(
        payload.href,
        "https://runtime.skitza.invalid",
      ).searchParams.get("studio");
      return payload.contextId === "artist-no-studio"
        ? studio === null
        : studio === payload.contextId;
    }
    return true;
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
    !runtimePayloadMatchesScope(scope, slot, value.payload)
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

function readRuntimeEnvelope<Slot extends RuntimeSlot>(
  storage: StorageLike,
  scope: RuntimeScope,
  slot: Slot,
  now = Date.now(),
): RuntimeEnvelope<RuntimePayloadBySlot[Slot]> | null {
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
    return parsed;
  } catch {
    safelyRemoveStorageItem(storage, key);
    return null;
  }
}

export function readRuntimeState<Slot extends RuntimeSlot>(
  storage: StorageLike,
  scope: RuntimeScope,
  slot: Slot,
  now = Date.now(),
): RuntimePayloadBySlot[Slot] | null {
  return readRuntimeEnvelope(storage, scope, slot, now)?.payload ?? null;
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
    !runtimePayloadMatchesScope(scope, slot, payload)
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

export function readRuntimeScreenSafeView(
  storage: StorageLike,
  identity: RuntimeStateIdentity,
  href: string,
  now = Date.now(),
): RuntimeScreenSafeView | null {
  if (identity.role === "artist") {
    const safeHref = normalizeRuntimeHref(href, identity.role);
    if (!safeHref) return null;
    const requestedStudio = new URL(
      safeHref,
      "https://runtime.skitza.invalid",
    ).searchParams.get("studio");
    if (
      identity.contextId === "artist-no-studio"
        ? requestedStudio !== null
        : requestedStudio !== identity.contextId
    ) {
      return null;
    }
  }
  const pathname = canonicalRuntimeScreenPathname(href, identity.role);
  if (!pathname) return null;
  const scope = runtimeScope(
    identity.userId,
    identity.role,
    identity.contextId,
    pathname,
  );
  return scope
    ? readRuntimeState(storage, scope, "runtime.screen.safe-view", now)
    : null;
}

export function writeRuntimeScreenSafeView(
  storage: StorageLike,
  identity: RuntimeStateIdentity,
  href: string,
  payload: RuntimeScreenSafeView,
  now = Date.now(),
): boolean {
  if (identity.role === "artist") {
    const safeHref = normalizeRuntimeHref(href, identity.role);
    if (!safeHref) return false;
    const requestedStudio = new URL(
      safeHref,
      "https://runtime.skitza.invalid",
    ).searchParams.get("studio");
    if (
      identity.contextId === "artist-no-studio"
        ? requestedStudio !== null
        : requestedStudio !== identity.contextId
    ) {
      return false;
    }
  }
  const pathname = canonicalRuntimeScreenPathname(href, identity.role);
  if (!pathname) return false;
  const scope = runtimeScope(
    identity.userId,
    identity.role,
    identity.contextId,
    pathname,
  );
  return scope
    ? writeRuntimeState(storage, scope, "runtime.screen.safe-view", payload, now)
    : false;
}

function runtimeLaunchScope(
  userId: string,
  role: RuntimeRole,
): RuntimeScope | null {
  return runtimeScope(
    userId,
    role,
    RUNTIME_LAUNCH_CONTEXT_ID,
    role === "producer" ? "/dashboard" : "/artist",
  );
}

export function writeRuntimeLaunchPointer(
  storage: StorageLike,
  identity: RuntimeStateIdentity,
  href: string,
  now = Date.now(),
): boolean {
  const safeHref = normalizeRuntimeHref(href, identity.role);
  if (!safeHref) return false;
  if (!canonicalRuntimeScreenPathname(safeHref, identity.role)) return false;
  if (identity.role === "artist") {
    const url = new URL(safeHref, "https://runtime.skitza.invalid");
    const requestedStudio = url.searchParams.get("studio");
    if (identity.contextId === "artist-no-studio") {
      if (requestedStudio !== null) return false;
    } else if (requestedStudio !== identity.contextId) {
      return false;
    }
  }
  const scope = runtimeLaunchScope(identity.userId, identity.role);
  if (!scope) return false;
  return writeRuntimeState(
    storage,
    scope,
    "runtime.launch.pointer",
    {
      contextId: identity.contextId,
      href: safeHref,
    },
    now,
  );
}

/**
 * Canonicalize the shell's current screen for a launch-pointer write. Artist
 * root navigation intentionally stays at plain `/artist` so the existing
 * resume bridge can run, but the stored pointer must carry the resolved studio
 * context or the strict launch writer will reject it.
 */
export function runtimeLaunchHrefForCurrentContext(
  identity: RuntimeStateIdentity,
  href: string,
): string | null {
  const safeHref = normalizeRuntimeHref(href, identity.role);
  if (!safeHref || identity.role !== "artist") return safeHref;

  const url = new URL(safeHref, "https://runtime.skitza.invalid");
  const requestedStudio = url.searchParams.get("studio");
  if (identity.contextId === "artist-no-studio") {
    return requestedStudio === null ? safeHref : null;
  }
  if (requestedStudio && requestedStudio !== identity.contextId) return null;
  if (!requestedStudio) url.searchParams.set("studio", identity.contextId);
  url.searchParams.sort();
  return `${url.pathname}?${url.searchParams.toString()}`;
}

export function readRuntimeLaunchTargetForRole(
  storage: StorageLike,
  userId: string,
  role: RuntimeRole,
  now = Date.now(),
): RuntimeLaunchTarget | null {
  const scope = runtimeLaunchScope(userId, role);
  const envelope = scope
    ? readRuntimeEnvelope(storage, scope, "runtime.launch.pointer", now)
    : null;
  return envelope ? { role, ...envelope.payload } : null;
}

/**
 * Restore the most recently used role while keeping each role's destination
 * separate. A tie is deterministic, but normal writes have distinct clocks.
 */
export function readRuntimeLaunchTarget(
  storage: StorageLike,
  userId: string,
  now = Date.now(),
): RuntimeLaunchTarget | null {
  const candidates = (["producer", "artist"] as const).flatMap((role) => {
    const scope = runtimeLaunchScope(userId, role);
    const envelope = scope
      ? readRuntimeEnvelope(storage, scope, "runtime.launch.pointer", now)
      : null;
    return envelope
      ? [{ role, updatedAt: envelope.updatedAt, ...envelope.payload }]
      : [];
  });
  candidates.sort((left, right) =>
    right.updatedAt !== left.updatedAt
      ? right.updatedAt - left.updatedAt
      : left.role.localeCompare(right.role),
  );
  const latest = candidates[0];
  return latest
    ? { role: latest.role, contextId: latest.contextId, href: latest.href }
    : null;
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

const SAFE_VIEW_SLOTS: readonly SafeViewRuntimeSlot[] = [
  "producer.overview.safe-view",
  "producer.workspace.safe-view",
  "producer.music.safe-view",
  "producer.store.safe-view",
  "producer.portfolio.safe-view",
  "artist.home.safe-view",
  "artist.music.safe-view",
  "runtime.screen.safe-view",
];

type SafeViewRuntimeSlot =
  | "producer.overview.safe-view"
  | "producer.workspace.safe-view"
  | "producer.music.safe-view"
  | "producer.store.safe-view"
  | "producer.portfolio.safe-view"
  | "artist.home.safe-view"
  | "artist.music.safe-view"
  | "runtime.screen.safe-view";

/**
 * Safe views are one record per route state. Keep the newest bounded set for
 * one authorized role/context, independent of the navigation-snapshot slot.
 */
export function pruneRuntimeSafeViews(
  storage: StorageLike,
  identity: Pick<RuntimeScope, "userId" | "role" | "contextId">,
  limit = RUNTIME_ROUTE_LIMIT,
): number {
  const prefix = [
    userStoragePrefix(identity.userId).slice(0, -1),
    `schema=${String(RUNTIME_STATE_SCHEMA_VERSION)}`,
    `role=${identity.role}`,
    `context=${encodeKeyPart(identity.contextId)}`,
  ].join(":");
  const suffixes = SAFE_VIEW_SLOTS.map((slot) => `:slot=${encodeKeyPart(slot)}`);
  const entries: Array<{ key: string; updatedAt: number }> = [];

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(`${prefix}:`) || !suffixes.some((suffix) => key.endsWith(suffix))) {
        continue;
      }
      const raw = storage.getItem(key);
      if (!raw) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        const updatedAt =
          isRecord(parsed) && isSafeInteger(parsed.updatedAt, 0) ? parsed.updatedAt : -1;
        entries.push({ key, updatedAt });
      } catch {
        entries.push({ key, updatedAt: -1 });
      }
    }
  } catch {
    return 0;
  }

  entries.sort((left, right) => right.updatedAt - left.updatedAt);
  const removeKeys = entries.slice(Math.max(0, limit)).map((entry) => entry.key);
  for (const key of removeKeys) safelyRemoveStorageItem(storage, key);
  return removeKeys.length;
}

/**
 * Returns an offline fallback owner only when the namespace contains exactly
 * one decodable Clerk user. Ambiguous or malformed private-state ownership
 * never gets guessed.
 */
export function findOnlyRuntimeStateUserId(storage: StorageLike): string | null {
  const prefix = `${KEY_NAMESPACE}:user=`;
  const users = new Set<string>();
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const schemaIndex = key.indexOf(":schema=", prefix.length);
      if (schemaIndex < 0) return null;
      const encodedUserId = key.slice(prefix.length, schemaIndex);
      let userId: string;
      try {
        userId = decodeURIComponent(encodedUserId);
      } catch {
        return null;
      }
      if (!isBoundedString(userId, 512)) return null;
      users.add(userId);
      if (users.size > 1) return null;
    }
  } catch {
    return null;
  }
  return users.values().next().value ?? null;
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
