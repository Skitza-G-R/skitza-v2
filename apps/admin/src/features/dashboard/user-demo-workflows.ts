import type {
  DemoAccountStatus,
  DemoSupportNote,
  DemoUserSummary,
} from "~/lib/admin-demo-view-models";

export type UserRoleFilter = "all" | "artist" | "both" | "producer";
export type UserStatusFilter = "active" | "all" | "needs-attention" | "suspended";
export type UserSortKey =
  | "activation"
  | "lastActivity"
  | "name"
  | "onboarding"
  | "roles"
  | "status";
export type SortDirection = "asc" | "desc";

export const PROFILE_TABS = ["summary", "activity", "business", "support"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

export function parseUserRoleFilter(value: string | undefined): UserRoleFilter {
  return value === "artist" || value === "both" || value === "producer" ? value : "all";
}

export function parseProfileTab(value: string | undefined): ProfileTab {
  return PROFILE_TABS.includes(value as ProfileTab) ? (value as ProfileTab) : "summary";
}

const STATUS_VALUES: Record<UserStatusFilter, DemoAccountStatus | null> = {
  active: "Active",
  all: null,
  "needs-attention": "Needs attention",
  suspended: "Suspended",
};

const ONBOARDING_ORDER = {
  "Not started": 0,
  "In progress": 1,
  Complete: 2,
} as const;

const ACTIVATION_ORDER = {
  "Not activated": 0,
  "Window open": 1,
  Activated: 2,
} as const;

const STATUS_ORDER: Record<DemoAccountStatus, number> = {
  Active: 0,
  "Needs attention": 1,
  Suspended: 2,
};

const ACTIVITY_ORDER: Record<string, number> = {
  "12 min ago": 12,
  "46 min ago": 46,
  "3 hours ago": 180,
  Yesterday: 1_440,
  "2 days ago": 2_880,
  "5 days ago": 7_200,
  "12 days ago": 17_280,
  "16 days ago": 23_040,
};

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

function sortValue(user: DemoUserSummary, key: UserSortKey): number | string {
  if (key === "name") return user.name;
  if (key === "roles") return user.roles.join(" + ");
  if (key === "status") return STATUS_ORDER[user.status];
  if (key === "onboarding") return ONBOARDING_ORDER[user.onboarding];
  if (key === "activation") return ACTIVATION_ORDER[user.activation];
  return ACTIVITY_ORDER[user.lastActivity] ?? Number.MAX_SAFE_INTEGER;
}

export function filterAndSortUsers(
  users: readonly DemoUserSummary[],
  options: Readonly<{
    query: string;
    role: UserRoleFilter;
    status: UserStatusFilter;
    sortDirection: SortDirection;
    sortKey: UserSortKey;
  }>,
): DemoUserSummary[] {
  const normalizedQuery = options.query.trim().toLowerCase();
  const selectedStatus = STATUS_VALUES[options.status];
  const direction = options.sortDirection === "asc" ? 1 : -1;

  return users
    .filter((user) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [user.name, user.email, user.id].some((value) =>
          value.toLowerCase().includes(normalizedQuery),
        );
      const matchesRole =
        options.role === "all" ||
        (options.role === "producer" && user.roles.includes("Producer")) ||
        (options.role === "artist" && user.roles.includes("Artist")) ||
        (options.role === "both" && user.roles.length === 2);

      return matchesQuery && matchesRole && (selectedStatus === null || user.status === selectedStatus);
    })
    .sort((left, right) => {
      const leftValue = sortValue(left, options.sortKey);
      const rightValue = sortValue(right, options.sortKey);
      const comparison =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : compareText(String(leftValue), String(rightValue));

      return comparison === 0 ? compareText(left.name, right.name) : comparison * direction;
    });
}

export function paginateUsers<T>(
  users: readonly T[],
  requestedPage: number,
  pageSize = 2,
): Readonly<{ currentPage: number; items: readonly T[]; pageCount: number }> {
  const pageCount = Math.max(1, Math.ceil(users.length / pageSize));
  const currentPage = Math.min(Math.max(1, requestedPage), pageCount);
  const start = (currentPage - 1) * pageSize;

  return {
    currentPage,
    items: users.slice(start, start + pageSize),
    pageCount,
  };
}

export type SupportDetailsInput = Readonly<{
  displayName: string;
  reason: string;
  tagsInput: string;
}>;

export type SupportDetailsValidation = Readonly<{
  displayName?: string;
  reason?: string;
  tagsInput?: string;
}>;

export function normalizeSupportTags(tagsInput: string): string[] {
  const seen = new Set<string>();

  return tagsInput
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => {
      const normalized = tag.toLowerCase();
      if (!tag || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

export function validateSupportDetails(
  input: SupportDetailsInput,
): SupportDetailsValidation {
  const errors: {
    displayName?: string;
    reason?: string;
    tagsInput?: string;
  } = {};
  const name = input.displayName.trim();
  const reason = input.reason.trim();
  const tags = normalizeSupportTags(input.tagsInput);

  if (name.length < 2 || name.length > 80) {
    errors.displayName = "Use a display name between 2 and 80 characters.";
  }
  if (tags.length > 5) {
    errors.tagsInput = "Use no more than 5 support tags.";
  } else if (tags.some((tag) => tag.length > 24)) {
    errors.tagsInput = "Keep each support tag at 24 characters or fewer.";
  }
  if (reason.length < 8) {
    errors.reason = "Explain the support reason in at least 8 characters.";
  }

  return errors;
}

export function validateRequiredReason(reason: string): string | null {
  return reason.trim().length >= 8
    ? null
    : "Explain the admin reason in at least 8 characters.";
}

export function validateSupportNote(note: string): string | null {
  const value = note.trim();
  if (value.length < 3) return "Write a note with at least 3 characters.";
  if (value.length > 500) return "Keep the note at 500 characters or fewer.";
  return null;
}

export function appendSupportNote(
  existing: readonly DemoSupportNote[],
  input: Readonly<{ body: string; id: string; addedAt: string; author?: string }>,
): DemoSupportNote[] {
  return [
    ...existing,
    {
      id: input.id,
      body: input.body.trim(),
      author: input.author ?? "Founder",
      addedAt: input.addedAt,
    },
  ];
}

export type WorkspaceDeletionInput = Readonly<{
  reason: string;
  registeredEmail: string;
  typedEmail: string;
}>;

export type WorkspaceDeletionValidation = Readonly<{
  reason?: string;
  typedEmail?: string;
}>;

export function validateWorkspaceDeletion(
  input: WorkspaceDeletionInput,
): WorkspaceDeletionValidation {
  const errors: { reason?: string; typedEmail?: string } = {};
  const reasonError = validateRequiredReason(input.reason);

  if (reasonError) errors.reason = reasonError;
  if (input.typedEmail !== input.registeredEmail) {
    errors.typedEmail = "Type the registered email exactly to continue.";
  }

  return errors;
}

export function updateUserStatus(
  user: DemoUserSummary,
  status: DemoAccountStatus,
): DemoUserSummary {
  return { ...user, status };
}

export function hasValidationErrors(errors: Readonly<Record<string, string | undefined>>): boolean {
  return Object.values(errors).some(Boolean);
}
