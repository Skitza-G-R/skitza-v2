import { createHash } from "node:crypto";

export const DIRECTORY_PAGE_SIZE = 25;

export const REGISTERED_USER_ROLES = ["Producer", "Artist"] as const;
export type RegisteredUserRole = (typeof REGISTERED_USER_ROLES)[number];
export type RegisteredUserRoleFilter = "all" | "artist" | "both" | "producer";
export type RegisteredUserStatusFilter =
  | "active"
  | "all"
  | "deleted"
  | "needs-attention"
  | "needs-sync"
  | "restricted";
export type RegisteredUserOnboardingFilter = "all" | "complete" | "not-complete";
export type RegisteredUserActivationFilter =
  | "activated"
  | "all"
  | "not-activated"
  | "not-recorded"
  | "window-open";
export type RegisteredUserSignupFilter = "7d" | "all" | "month" | "today";
export type RegisteredUserActivityFilter = "30d" | "7d" | "all" | "none";
export type RegisteredUserSort =
  | "last-activity"
  | "name"
  | "signup"
  | "status";
export type SortDirection = "asc" | "desc";

export type RegisteredUserDirectoryQuery = Readonly<{
  activation: RegisteredUserActivationFilter;
  activity: RegisteredUserActivityFilter;
  direction: SortDirection;
  onboarding: RegisteredUserOnboardingFilter;
  cursor: string | null;
  pageSize: typeof DIRECTORY_PAGE_SIZE;
  query: string;
  role: RegisteredUserRoleFilter;
  signup: RegisteredUserSignupFilter;
  sort: RegisteredUserSort;
  status: RegisteredUserStatusFilter;
}>;

type RawSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

function one(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function exact<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function parseRegisteredUserDirectoryQuery(
  raw: RawSearchParams,
): RegisteredUserDirectoryQuery {
  const requestedCursor = one(raw.cursor)?.trim() ?? "";
  return {
    activation: exact(
      one(raw.activation),
      ["all", "activated", "not-activated", "not-recorded", "window-open"],
      "all",
    ),
    activity: exact(one(raw.activity), ["all", "7d", "30d", "none"], "all"),
    direction: exact(one(raw.dir), ["asc", "desc"], "desc"),
    onboarding: exact(one(raw.onboarding), ["all", "complete", "not-complete"], "all"),
    cursor:
      requestedCursor && /^[A-Za-z0-9_-]{1,2000}$/.test(requestedCursor)
        ? requestedCursor
        : null,
    pageSize: DIRECTORY_PAGE_SIZE,
    query: (one(raw.q) ?? "").trim().slice(0, 100),
    role: exact(one(raw.role), ["all", "artist", "both", "producer"], "all"),
    signup: exact(one(raw.signup), ["all", "today", "7d", "month"], "all"),
    sort: exact(
      one(raw.sort),
      ["last-activity", "name", "signup", "status"],
      "signup",
    ),
    status: exact(
      one(raw.status),
      ["all", "active", "deleted", "needs-attention", "needs-sync", "restricted"],
      "all",
    ),
  };
}

export type RegisteredUserCursorDirection = "after" | "before";
export type RegisteredUserCursor = Readonly<{
  clerkUserId: string;
  direction: RegisteredUserCursorDirection;
  environment: "live" | "test";
  filterDigest: string;
  nullRank: 0 | 1;
  sortValue: string | null;
  version: 1;
}>;

export class RegisteredUserCursorError extends Error {
  constructor() {
    super("INVALID_REGISTERED_USER_CURSOR");
    this.name = "RegisteredUserCursorError";
  }
}

export function registeredUserFilterDigest(
  environment: "live" | "test",
  query: RegisteredUserDirectoryQuery,
): string {
  const canonical = JSON.stringify({
    activation: query.activation,
    activity: query.activity,
    direction: query.direction,
    environment,
    onboarding: query.onboarding,
    query: query.query,
    role: query.role,
    signup: query.signup,
    sort: query.sort,
    status: query.status,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function encodeRegisteredUserCursor(
  cursor: RegisteredUserCursor,
): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeRegisteredUserCursor(
  value: string,
  expected: Readonly<{
    environment: "live" | "test";
    filterDigest: string;
    sort?: RegisteredUserSort;
  }>,
): RegisteredUserCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new RegisteredUserCursorError();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RegisteredUserCursorError();
  }
  const candidate = parsed as Record<string, unknown>;
  const sortValueIsValid =
    (candidate.nullRank === 1 && candidate.sortValue === null) ||
    (candidate.nullRank === 0 &&
      typeof candidate.sortValue === "string" &&
      candidate.sortValue.length <= 500 &&
      !candidate.sortValue.includes("\u0000"));
  const timestampSortValueIsValid =
    expected.sort !== "signup" && expected.sort !== "last-activity"
      ? true
      : (candidate.nullRank === 1 && candidate.sortValue === null) ||
        (candidate.nullRank === 0 &&
          typeof candidate.sortValue === "string" &&
          Number.isFinite(new Date(candidate.sortValue).getTime()) &&
          new Date(candidate.sortValue).toISOString() === candidate.sortValue);
  if (
    candidate.version !== 1 ||
    candidate.environment !== expected.environment ||
    candidate.filterDigest !== expected.filterDigest ||
    (candidate.direction !== "after" && candidate.direction !== "before") ||
    (candidate.nullRank !== 0 && candidate.nullRank !== 1) ||
    typeof candidate.clerkUserId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(candidate.clerkUserId) ||
    !sortValueIsValid ||
    !timestampSortValueIsValid
  ) {
    throw new RegisteredUserCursorError();
  }
  return candidate as unknown as RegisteredUserCursor;
}

export function deriveRegisteredUserRoles(input: Readonly<{
  hasArtistRelationships: boolean;
  hasProducer: boolean;
}>): RegisteredUserRole[] {
  const roles: RegisteredUserRole[] = [];
  if (input.hasProducer) roles.push("Producer");
  if (input.hasArtistRelationships) roles.push("Artist");
  return roles;
}

export function matchesRegisteredUserRole(
  roles: readonly RegisteredUserRole[],
  filter: RegisteredUserRoleFilter,
): boolean {
  if (filter === "all") return true;
  const producer = roles.includes("Producer");
  const artist = roles.includes("Artist");
  if (filter === "producer") return producer;
  if (filter === "artist") return artist;
  return producer && artist;
}

const ACTIVATION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function deriveRegisteredUserActivation(input: Readonly<{
  audienceType: "external" | "internal" | "unknown";
  environment: "live" | "test";
  firstExternalEventAt: Date | null;
  hasProducer: boolean;
  hasUnclassifiedEventInWindow: boolean;
  now: Date;
  producerCreatedAt: Date | null;
}>):
  | "Activated"
  | "Not activated"
  | "Not applicable"
  | "Not recorded"
  | "Window open" {
  if (!input.hasProducer) return "Not applicable";
  if (
    input.environment !== "live" ||
    input.audienceType !== "external" ||
    input.producerCreatedAt === null
  ) {
    return "Not recorded";
  }
  const deadline = new Date(
    input.producerCreatedAt.getTime() + ACTIVATION_WINDOW_MS,
  );
  if (
    input.firstExternalEventAt &&
    input.firstExternalEventAt >= input.producerCreatedAt &&
    input.firstExternalEventAt <= deadline
  ) {
    return "Activated";
  }
  if (input.hasUnclassifiedEventInWindow) return "Not recorded";
  return input.now <= deadline ? "Window open" : "Not activated";
}
