import type { AdminEnvironmentId } from "~/server/environment";

export const ADMIN_DEMO_DATA_MARKER = "Demo data" as const;

export type DemoCapability = Readonly<{
  enabled: false;
  reason: "Demo mode — no real action will run.";
}>;

export type TrendDirection = "down" | "flat" | "up";
export type StatusTone = "danger" | "info" | "muted" | "success" | "warning";

export type DemoMetric = Readonly<{
  id: string;
  label: string;
  value: string;
  detail: string;
  change?: string;
  direction?: TrendDirection;
  tone?: StatusTone;
}>;

export type DemoAttentionItem = Readonly<{
  id: string;
  category: "Account" | "Payment" | "System";
  title: string;
  detail: string;
  age: string;
  tone: "danger" | "warning";
  href: string;
}>;

export type DemoChartPoint = Readonly<{
  label: string;
  value: number;
  secondaryValue?: number;
}>;

export type DemoActivity = Readonly<{
  id: string;
  label: string;
  detail: string;
  occurredAt: string;
  tone: StatusTone;
}>;

export type DemoProvider = Readonly<{
  id: string;
  name: string;
  status: "Operational" | "Investigating" | "Unavailable";
  detail: string;
}>;

export type DemoOverview = Readonly<{
  environment: AdminEnvironmentId;
  updatedAt: string;
  metrics: readonly [DemoMetric, DemoMetric, DemoMetric, DemoMetric];
  attention: readonly DemoAttentionItem[];
  activationTrend: readonly DemoChartPoint[];
  activityTrend: readonly DemoChartPoint[];
  recentActivity: readonly DemoActivity[];
  providers: readonly DemoProvider[];
}>;

export type DemoRole = "Artist" | "Producer";
export type DemoAccountStatus = "Active" | "Needs attention" | "Suspended";

export type DemoUserSummary = Readonly<{
  id: string;
  initials: string;
  name: string;
  email: string;
  roles: readonly DemoRole[];
  status: DemoAccountStatus;
  onboarding: "Complete" | "In progress" | "Not started";
  activation: "Activated" | "Not activated" | "Window open";
  joinedAt: string;
  lastActivity: string;
  publicPage: "Hidden" | "Visible";
  emailDelivery: "Delivered" | "Failed";
}>;

export type DemoProfileFact = Readonly<{
  label: string;
  value: string;
}>;

export type DemoSupportNote = Readonly<{
  id: string;
  body: string;
  author: string;
  addedAt: string;
}>;

export type DemoUserProfile = Readonly<{
  environment: AdminEnvironmentId;
  updatedAt: string;
  user: DemoUserSummary;
  supportDisplayName: string;
  supportTags: readonly string[];
  supportNotes: readonly DemoSupportNote[];
  summary: readonly DemoProfileFact[];
  activity: readonly DemoActivity[];
  business: readonly DemoProfileFact[];
  support: readonly DemoProfileFact[];
  capability: DemoCapability;
}>;

export type DemoUserDirectory = Readonly<{
  environment: AdminEnvironmentId;
  updatedAt: string;
  users: readonly DemoUserSummary[];
}>;

export type DemoPayment = Readonly<{
  id: string;
  producerUserId: string;
  producer: string;
  artist: string;
  project: string;
  amount: string;
  currency: "ILS" | "USD";
  state: "Approved" | "Needs producer approval" | "Proof rejected" | "Proof submitted";
  retrySupported: boolean;
  attentionReason?: string;
  updatedAt: string;
  timeline: readonly DemoActivity[];
}>;

export type DemoPayments = Readonly<{
  environment: AdminEnvironmentId;
  updatedAt: string;
  totals: readonly DemoMetric[];
  payments: readonly DemoPayment[];
  capability: DemoCapability;
}>;

export type DemoAnalytics = Readonly<{
  environment: AdminEnvironmentId;
  updatedAt: string;
  metrics: readonly DemoMetric[];
  activationCohorts: readonly DemoChartPoint[];
  weeklyActive: readonly DemoChartPoint[];
  retention: readonly DemoChartPoint[];
  salesByCurrency: readonly DemoChartPoint[];
}>;

export type DemoProblem = Readonly<{
  id: string;
  title: string;
  detail: string;
  provider: string;
  state: "New" | "Resolved" | "Seen";
  severity: "Critical" | "Warning";
  firstSeenAt: string;
}>;

export type DemoAuditEntry = Readonly<{
  id: string;
  action: string;
  target: string;
  actor: string;
  outcome: "Failed" | "Succeeded";
  occurredAt: string;
}>;

export type DemoSystemHealth = Readonly<{
  environment: AdminEnvironmentId;
  updatedAt: string;
  providers: readonly DemoProvider[];
  problems: readonly DemoProblem[];
  history: readonly DemoAuditEntry[];
  capability: DemoCapability;
}>;

export interface AdminReadRepository {
  getOverview(environment: AdminEnvironmentId): Promise<DemoOverview>;
  searchUsers(environment: AdminEnvironmentId): Promise<DemoUserDirectory>;
  getUserProfile(environment: AdminEnvironmentId, userId: string): Promise<DemoUserProfile | null>;
  listPayments(environment: AdminEnvironmentId): Promise<DemoPayments>;
  getPayment(environment: AdminEnvironmentId, paymentId: string): Promise<DemoPayment | null>;
  getAnalytics(environment: AdminEnvironmentId): Promise<DemoAnalytics>;
  getSystemHealth(environment: AdminEnvironmentId): Promise<DemoSystemHealth>;
}
