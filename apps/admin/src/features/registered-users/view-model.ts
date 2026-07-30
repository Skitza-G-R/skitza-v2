import type { AdminEnvironmentId } from "~/server/environment";
import type {
  RegisteredUserDirectoryQuery,
  RegisteredUserRoleFilter,
  RegisteredUserStatusFilter,
} from "~/server/registered-users/model";

export type DirectoryQueryUpdate = Partial<
  Pick<
    RegisteredUserDirectoryQuery,
    | "activation"
    | "activity"
    | "cursor"
    | "direction"
    | "onboarding"
    | "query"
    | "role"
    | "signup"
    | "sort"
    | "status"
  >
>;

export const ROLE_FILTERS: readonly Readonly<{
  label: string;
  value: RegisteredUserRoleFilter;
}>[] = [
  { label: "All", value: "all" },
  { label: "Producers", value: "producer" },
  { label: "Artists", value: "artist" },
  { label: "Both", value: "both" },
];

export const STATUS_FILTERS: readonly Readonly<{
  label: string;
  value: RegisteredUserStatusFilter;
}>[] = [
  { label: "Current accounts", value: "all" },
  { label: "Active", value: "active" },
  { label: "Needs attention", value: "needs-attention" },
  { label: "Needs sync", value: "needs-sync" },
  { label: "Restricted", value: "restricted" },
  { label: "Deleted", value: "deleted" },
];

function setUnlessDefault(
  params: URLSearchParams,
  key: string,
  value: string,
  defaultValue: string,
) {
  if (value !== defaultValue) params.set(key, value);
}

export function buildUsersDirectoryHref(
  environment: AdminEnvironmentId,
  query: RegisteredUserDirectoryQuery,
  update: DirectoryQueryUpdate = {},
): string {
  const hasCursorUpdate = Object.prototype.hasOwnProperty.call(update, "cursor");
  const next = {
    ...query,
    ...update,
    cursor: hasCursorUpdate ? (update.cursor ?? null) : null,
  };
  const params = new URLSearchParams();
  if (next.query) params.set("q", next.query);
  setUnlessDefault(params, "role", next.role, "all");
  setUnlessDefault(params, "status", next.status, "all");
  setUnlessDefault(params, "onboarding", next.onboarding, "all");
  setUnlessDefault(params, "activation", next.activation, "all");
  setUnlessDefault(params, "signup", next.signup, "all");
  setUnlessDefault(params, "activity", next.activity, "all");
  setUnlessDefault(params, "sort", next.sort, "signup");
  setUnlessDefault(params, "dir", next.direction, "desc");
  if (next.cursor) params.set("cursor", next.cursor);
  const search = params.toString();
  return `/${environment}/users${search ? `?${search}` : ""}`;
}

export function buildUserProfileHref(
  environment: AdminEnvironmentId,
  userId: string,
  tab: "activity" | "business" | "summary" | "support",
  activityCursor?: string | null,
): string {
  const params = new URLSearchParams();
  if (tab !== "summary") params.set("tab", tab);
  if (tab === "activity" && activityCursor) {
    params.set("cursor", activityCursor);
  }
  const search = params.toString();
  return `/${environment}/users/${encodeURIComponent(userId)}${search ? `?${search}` : ""}`;
}

export function hasDirectoryFilters(
  query: RegisteredUserDirectoryQuery,
): boolean {
  return (
    query.activation !== "all" ||
    query.activity !== "all" ||
    query.onboarding !== "all" ||
    query.query !== "" ||
    query.role !== "all" ||
    query.signup !== "all" ||
    query.status !== "all"
  );
}

export function hasAdvancedDirectoryState(
  query: RegisteredUserDirectoryQuery,
): boolean {
  return (
    query.activation !== "all" ||
    query.activity !== "all" ||
    query.onboarding !== "all" ||
    query.signup !== "all"
  );
}

export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase()).join("") || "?";
}

export function formatAdminDate(value: Date | null): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
    year: "numeric",
  }).format(value);
}

export function humanizeAdminCode(value: string): string {
  const result = value
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .trim();
  return result
    ? `${result[0]?.toUpperCase() ?? ""}${result.slice(1)}`
    : "Recorded activity";
}

export function safeMetadataEntries(
  value: Readonly<Record<string, unknown>>,
): readonly Readonly<{ key: string; value: string }>[] {
  return Object.entries(value)
    .filter(
      (entry): entry is [string, boolean | number | string] =>
        typeof entry[1] === "boolean" ||
        typeof entry[1] === "number" ||
        typeof entry[1] === "string",
    )
    .slice(0, 4)
    .map(([key, item]) => ({
      key: humanizeAdminCode(key),
      value: String(item).slice(0, 120),
    }));
}

export function isValidRegisteredUserId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value);
}
