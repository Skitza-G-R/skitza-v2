import type { AdminEnvironmentId } from "~/server/environment";
import type {
  RegisteredUserDirectoryQuery,
  RegisteredUserRole,
} from "./model";

export type RegisteredUserDirectoryStatus =
  | "Active"
  | "Deleted"
  | "Needs attention"
  | "Needs sync"
  | "Restricted";
export type RegisteredUserOnboarding =
  | "Complete"
  | "Not applicable"
  | "Not complete";
export type RegisteredUserActivation =
  | "Activated"
  | "Not activated"
  | "Not applicable"
  | "Not recorded"
  | "Window open";
export type RegisteredUserIdentitySource =
  | "Clerk"
  | "Mixed"
  | "Skitza"
  | "Unavailable";

export type RegisteredUserSummary = Readonly<{
  activation: RegisteredUserActivation;
  clerkUserId: string;
  displayName: string;
  email: string | null;
  identitySource: RegisteredUserIdentitySource;
  lastMeaningfulActivityAt: Date | null;
  onboarding: RegisteredUserOnboarding;
  providerCreatedAt: Date | null;
  roles: readonly RegisteredUserRole[];
  status: RegisteredUserDirectoryStatus;
}>;

export type RegisteredUserDirectoryPage = Readonly<{
  cursorReset: boolean;
  items: readonly RegisteredUserSummary[];
  nextCursor: string | null;
  previousCursor: string | null;
  totalCount: number;
}>;

export type RegisteredUserProfileTab =
  | "activity"
  | "business"
  | "summary"
  | "support";

export const REGISTERED_USER_PROFILE_TABS = [
  "summary",
  "activity",
  "business",
  "support",
] as const;

export class RegisteredUserProfileAccessError extends Error {
  constructor() {
    super("REGISTERED_USER_PROFILE_NOT_FOUND");
    this.name = "RegisteredUserProfileAccessError";
  }
}

export function parseRegisteredUserProfileTab(
  value: string | readonly string[] | undefined,
): RegisteredUserProfileTab {
  const selected = typeof value === "string" ? value : undefined;
  return REGISTERED_USER_PROFILE_TABS.includes(
    selected as RegisteredUserProfileTab,
  )
    ? (selected as RegisteredUserProfileTab)
    : "summary";
}

export type RegisteredUserProfileHeader = RegisteredUserSummary &
  Readonly<{
    audienceType: "external" | "internal" | "unknown";
    emailVerified: boolean | null;
    lastSignInAt: Date | null;
    providerState: string;
    providerUpdatedAt: Date | null;
  }>;

export type RegisteredUserActivityItem = Readonly<{
  eventName: string;
  id: string;
  occurredAt: Date;
  safeMetadata: Readonly<Record<string, unknown>>;
  targetId: string;
  targetType: string;
}>;

export type RegisteredUserBusinessData = Readonly<{
  counts: Readonly<{
    asArtist: RegisteredUserBusinessCounts;
    asProducer: RegisteredUserBusinessCounts;
  }>;
  producer: Readonly<{
    createdAt: Date;
    displayName: string | null;
    email: string;
    id: string;
    onboarding: RegisteredUserOnboarding;
    slug: string;
  }> | null;
  studios: readonly Readonly<{
    archivedAt: Date | null;
    id: string;
    lastSeenAt: Date;
    producerArchivedAt: Date | null;
    producerDisplayName: string | null;
    producerId: string;
  }>[];
  studiosTruncated: boolean;
  totalStudios: number;
}>;

export type RegisteredUserBusinessCounts = Readonly<{
  bookings: number;
  paymentRecords: number;
  projects: number;
  purchaseRequests: number;
  purchases: number;
}>;

export type RegisteredUserSupportData = Readonly<{
  items: readonly Readonly<{
    action: string | null;
    actorClerkUserId: string;
    id: string;
    kind: "audit" | "note";
    occurredAt: Date;
    outcome: string | null;
  }>[];
  provider: Readonly<{
    lastEventReference: string | null;
    state: string;
    syncedAt: Date | null;
    updatedAt: Date | null;
  }>;
  totalItems: number;
  truncated: boolean;
}>;

export type RegisteredUserProfileTabData =
  | Readonly<{
      cursorReset: boolean;
      items: readonly RegisteredUserActivityItem[];
      nextCursor: string | null;
      tab: "activity";
    }>
  | Readonly<{ data: RegisteredUserBusinessData; tab: "business" }>
  | Readonly<{ tab: "summary" }>
  | Readonly<{ data: RegisteredUserSupportData; tab: "support" }>;

export interface RegisteredUserRepository {
  findDirectory(
    query: RegisteredUserDirectoryQuery,
  ): Promise<RegisteredUserDirectoryPage>;
  findProfileHeader(clerkUserId: string): Promise<RegisteredUserProfileHeader | null>;
  findProfileTab(
    clerkUserId: string,
    tab: RegisteredUserProfileTab,
    options?: Readonly<{
      activityCursor?: string | null;
      allowDeletedSummary?: boolean;
    }>,
  ): Promise<RegisteredUserProfileTabData>;
}

export type RegisteredUserRuntime = Readonly<{
  environment: AdminEnvironmentId;
  providerDashboardUrl: string;
  repository: RegisteredUserRepository;
}>;
