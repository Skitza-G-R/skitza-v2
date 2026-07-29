import type { AdminEnvironmentId } from "~/server/environment";
import type {
  AdminReadRepository,
  DemoAnalytics,
  DemoCapability,
  DemoOverview,
  DemoPayments,
  DemoSystemHealth,
  DemoUserDirectory,
  DemoUserProfile,
} from "~/lib/admin-demo-view-models";

const DEMO_CAPABILITY: DemoCapability = Object.freeze({
  enabled: false,
  reason: "Demo mode — no real action will run.",
});

type DemoDataset = Readonly<{
  overview: DemoOverview;
  users: DemoUserDirectory;
  profiles: Readonly<Record<string, DemoUserProfile>>;
  payments: DemoPayments;
  analytics: DemoAnalytics;
  health: DemoSystemHealth;
}>;

function createDataset(environment: AdminEnvironmentId): DemoDataset {
  const live = environment === "live";
  const prefix = `demo_${environment}`;
  const updatedAt = live ? "29 Jul 2026 · 07:40" : "29 Jul 2026 · 07:32";
  const path = `/${environment}`;

  const users = [
    {
      id: `${prefix}_user_maya`,
      initials: "ML",
      name: live ? "Maya Levi" : "Maya Demo",
      email: live ? "maya.live@example.com" : "maya.test@example.com",
      roles: ["Producer"] as const,
      status: "Active" as const,
      onboarding: "Complete" as const,
      activation: "Activated" as const,
      joinedAt: live ? "18 Jul 2026" : "22 Jul 2026",
      lastActivity: live ? "12 min ago" : "46 min ago",
    },
    {
      id: `${prefix}_user_noah`,
      initials: "NC",
      name: live ? "Noah Cohen" : "Noah Sandbox",
      email: live ? "noah.live@example.com" : "noah.test@example.com",
      roles: ["Artist", "Producer"] as const,
      status: "Needs attention" as const,
      onboarding: "In progress" as const,
      activation: "Window open" as const,
      joinedAt: live ? "27 Jul 2026" : "24 Jul 2026",
      lastActivity: live ? "Yesterday" : "3 hours ago",
    },
    {
      id: `${prefix}_user_lina`,
      initials: "LA",
      name: live ? "Lina Amar" : "Lina Preview",
      email: live ? "lina.live@example.com" : "lina.test@example.com",
      roles: ["Artist"] as const,
      status: "Active" as const,
      onboarding: "Complete" as const,
      activation: "Not activated" as const,
      joinedAt: live ? "03 Jul 2026" : "09 Jul 2026",
      lastActivity: live ? "2 days ago" : "5 days ago",
    },
    {
      id: `${prefix}_user_eli`,
      initials: "EB",
      name: live ? "Eli Bar" : "Eli Fixture",
      email: live ? "eli.live@example.com" : "eli.test@example.com",
      roles: ["Producer"] as const,
      status: "Suspended" as const,
      onboarding: "Not started" as const,
      activation: "Not activated" as const,
      joinedAt: live ? "28 Jun 2026" : "02 Jul 2026",
      lastActivity: live ? "16 days ago" : "12 days ago",
    },
  ] as const;

  const activities = [
    {
      id: `${prefix}_activity_purchase`,
      label: "Payment proof submitted",
      detail: `${users[0].name} · Midnight Echoes`,
      occurredAt: "12 min ago",
      tone: "warning" as const,
    },
    {
      id: `${prefix}_activity_booking`,
      label: "First real booking created",
      detail: `${users[1].name} activated`,
      occurredAt: "41 min ago",
      tone: "success" as const,
    },
    {
      id: `${prefix}_activity_signup`,
      label: "Registered producer",
      detail: `${users[3].name} started onboarding`,
      occurredAt: "2 hours ago",
      tone: "info" as const,
    },
  ] as const;

  const payments = [
    {
      id: `${prefix}_payment_amber`,
      producer: users[0].name,
      artist: "Ari Stone",
      project: "Midnight Echoes",
      amount: live ? "₪2,400" : "₪1,200",
      currency: "ILS" as const,
      state: "Proof submitted" as const,
      attentionReason: "Payment proof is waiting for producer approval.",
      updatedAt: "12 min ago",
    },
    {
      id: `${prefix}_payment_blue`,
      producer: users[1].name,
      artist: "Jamie North",
      project: "First Light",
      amount: live ? "$680" : "$340",
      currency: "USD" as const,
      state: "Proof rejected" as const,
      attentionReason: "Rejected proof is waiting for a new upload.",
      updatedAt: "3 hours ago",
    },
    {
      id: `${prefix}_payment_green`,
      producer: users[0].name,
      artist: "Dani Fox",
      project: "Soft Static",
      amount: live ? "₪1,800" : "₪900",
      currency: "ILS" as const,
      state: "Approved" as const,
      updatedAt: "Yesterday",
    },
  ] as const;

  const providers = [
    {
      id: `${prefix}_provider_clerk`,
      name: "Clerk",
      status: "Operational" as const,
      detail: "Sign-in and identity",
    },
    {
      id: `${prefix}_provider_neon`,
      name: "Neon",
      status: "Operational" as const,
      detail: "Application database",
    },
    {
      id: `${prefix}_provider_resend`,
      name: "Resend",
      status: live ? ("Investigating" as const) : ("Operational" as const),
      detail: live ? "Repeated delivery delay" : "Email delivery",
    },
    {
      id: `${prefix}_provider_sentry`,
      name: "Sentry",
      status: "Operational" as const,
      detail: "Error monitoring",
    },
  ] as const;

  const overview: DemoOverview = {
    environment,
    updatedAt,
    metrics: [
      {
        id: `${prefix}_metric_activation`,
        label: "Producer activation rate",
        value: live ? "38.6%" : "44.0%",
        detail: "Mature 14-day cohorts",
        change: live ? "+4.2 pts" : "+2.0 pts",
        direction: "up",
      },
      {
        id: `${prefix}_metric_wau`,
        label: "Weekly active producers",
        value: live ? "84" : "11",
        detail: "Meaningful work · trailing 7 days",
        change: live ? "+9 this week" : "+3 this week",
        direction: "up",
      },
      {
        id: `${prefix}_metric_sales`,
        label: "Verified sales recorded",
        value: live ? "₪48.2k" : "₪6.1k",
        detail: live ? "$8.4k USD separately" : "$1.2k USD separately",
        change: "Proof verified, not bank settlement",
        direction: "flat",
      },
      {
        id: `${prefix}_metric_problems`,
        label: "Open problems",
        value: "2",
        detail: "1 new · 1 seen",
        change: live ? "Needs review" : "No critical incidents",
        direction: live ? "up" : "flat",
        tone: live ? "danger" : "warning",
      },
    ],
    attention: [
      {
        id: `${prefix}_attention_email`,
        category: "System",
        title: live ? "Important emails delayed" : "Test email retry queued",
        detail: live
          ? "Seven important messages exceeded the delivery threshold."
          : "One sandbox delivery is waiting for the next retry.",
        age: live ? "18 min" : "11 min",
        tone: "danger",
        href: `${path}/system-health`,
      },
      {
        id: `${prefix}_attention_payment`,
        category: "Payment",
        title: "Payment proofs need decisions",
        detail: live
          ? "Two producers have not reviewed submitted proof."
          : "One demo proof is waiting for review.",
        age: live ? "42 min" : "26 min",
        tone: "warning",
        href: `${path}/payments?view=attention`,
      },
      {
        id: `${prefix}_attention_account`,
        category: "Account",
        title: "Role mapping needs attention",
        detail: `${users[1].name} has a registered identity with an incomplete role mapping.`,
        age: "2 hr",
        tone: "warning",
        href: `${path}/users/${users[1].id}`,
      },
    ],
    activationTrend: [
      { label: "1 Jul", value: live ? 28 : 32, secondaryValue: live ? 22 : 24 },
      { label: "8 Jul", value: live ? 31 : 35, secondaryValue: live ? 25 : 27 },
      { label: "15 Jul", value: live ? 35 : 40, secondaryValue: live ? 29 : 31 },
      { label: "22 Jul", value: live ? 39 : 44, secondaryValue: live ? 34 : 35 },
    ],
    activityTrend: [
      { label: "Wed", value: live ? 64 : 7 },
      { label: "Thu", value: live ? 71 : 8 },
      { label: "Fri", value: live ? 69 : 6 },
      { label: "Sat", value: live ? 52 : 5 },
      { label: "Sun", value: live ? 61 : 7 },
      { label: "Mon", value: live ? 78 : 10 },
      { label: "Tue", value: live ? 84 : 11 },
    ],
    recentActivity: activities,
    providers,
  };

  const directory: DemoUserDirectory = {
    environment,
    updatedAt,
    users,
  };

  const profiles = Object.fromEntries(
    users.map((user) => {
      const roles: readonly string[] = user.roles;
      const profileActivity = [
        {
          id: `${user.id}_profile_activity`,
          label:
            user.activation === "Activated"
              ? "Activation milestone reached"
              : "Account state recorded",
          detail: `${user.name} · ${user.activation}`,
          occurredAt: user.lastActivity,
          tone:
            user.status === "Active"
              ? ("success" as const)
              : user.status === "Suspended"
                ? ("danger" as const)
                : ("warning" as const),
        },
      ] as const;

      return [
        user.id,
        {
          environment,
          updatedAt,
          user,
          summary: [
            { label: "Clerk identity", value: user.id },
            { label: "Environment", value: environment === "live" ? "Live" : "Test" },
            { label: "Joined", value: user.joinedAt },
            { label: "Last meaningful activity", value: user.lastActivity },
            { label: "Onboarding", value: user.onboarding },
            { label: "Activation", value: user.activation },
          ],
          activity: profileActivity,
          business: [
            { label: "Producer workspaces", value: roles.includes("Producer") ? "1" : "0" },
            { label: "Artist relationships", value: roles.includes("Artist") ? "3" : "0" },
            { label: "Open projects", value: user.status === "Active" ? "4" : "1" },
            { label: "Recorded sales", value: roles.includes("Producer") ? "6" : "—" },
          ],
          support: [
            {
              label: "Open support problems",
              value: user.status === "Needs attention" ? "1" : "0",
            },
            { label: "Private notes", value: "Unavailable in demo mode" },
            { label: "Sensitive content", value: "Hidden" },
            { label: "Last admin action", value: "No real actions connected" },
          ],
          capability: DEMO_CAPABILITY,
        } satisfies DemoUserProfile,
      ];
    }),
  );

  const paymentData: DemoPayments = {
    environment,
    updatedAt,
    totals: [
      {
        id: `${prefix}_payment_total_ils`,
        label: "Verified ILS recorded",
        value: live ? "₪48,240" : "₪6,100",
        detail: "ILS only",
      },
      {
        id: `${prefix}_payment_total_usd`,
        label: "Verified USD recorded",
        value: live ? "$8,420" : "$1,200",
        detail: "USD only",
      },
      {
        id: `${prefix}_payment_total_attention`,
        label: "Needs attention",
        value: "2",
        detail: "Proofs and state mismatches",
        tone: "warning",
      },
    ],
    payments,
    capability: DEMO_CAPABILITY,
  };

  const analytics: DemoAnalytics = {
    environment,
    updatedAt,
    metrics: [
      overview.metrics[0],
      overview.metrics[1],
      {
        id: `${prefix}_metric_retention`,
        label: "Four-week retention",
        value: live ? "46.8%" : "51.0%",
        detail: "Activated producers returning to meaningful work",
        change: live ? "+3.1 pts" : "+1.0 pt",
        direction: "up",
      },
      overview.metrics[2],
    ],
    activationCohorts: overview.activationTrend,
    weeklyActive: overview.activityTrend,
    retention: [
      { label: "Apr", value: live ? 41 : 45 },
      { label: "May", value: live ? 44 : 47 },
      { label: "Jun", value: live ? 47 : 51 },
    ],
    salesByCurrency: [
      { label: "ILS", value: live ? 48240 : 6100 },
      { label: "USD", value: live ? 8420 : 1200 },
    ],
  };

  const health: DemoSystemHealth = {
    environment,
    updatedAt,
    providers,
    problems: [
      {
        id: `${prefix}_problem_email`,
        title: live ? "Important email delivery delayed" : "Sandbox email retry queued",
        detail: live
          ? "Repeated delivery latency passed the serious-problem threshold."
          : "A demo message is waiting for a scheduled retry.",
        provider: "Resend",
        state: "New",
        severity: live ? "Critical" : "Warning",
        firstSeenAt: live ? "18 min ago" : "11 min ago",
      },
      {
        id: `${prefix}_problem_webhook`,
        title: "Payment callback recovered",
        detail: "A repeated callback failure stopped after the latest retry.",
        provider: "Payments",
        state: "Seen",
        severity: "Warning",
        firstSeenAt: "2 hours ago",
      },
      {
        id: `${prefix}_problem_signup`,
        title: "Signup errors returned to baseline",
        detail: "The sustained error increase ended without data loss.",
        provider: "Clerk",
        state: "Resolved",
        severity: "Warning",
        firstSeenAt: "Yesterday",
      },
    ],
    history: [
      {
        id: `${prefix}_audit_reveal`,
        action: "Viewed private support content",
        target: users[1].email,
        actor: "Founder",
        outcome: "Succeeded",
        occurredAt: "Today · 06:52",
      },
      {
        id: `${prefix}_audit_retry`,
        action: "Retried important email",
        target: users[0].email,
        actor: "Founder",
        outcome: "Succeeded",
        occurredAt: "Yesterday · 17:14",
      },
      {
        id: `${prefix}_audit_hide`,
        action: "Hide public page requested",
        target: users[3].email,
        actor: "Founder",
        outcome: "Failed",
        occurredAt: "Yesterday · 12:08",
      },
    ],
    capability: DEMO_CAPABILITY,
  };

  return Object.freeze({
    overview,
    users: directory,
    profiles: Object.freeze(profiles),
    payments: paymentData,
    analytics,
    health,
  });
}

const DATASETS = Object.freeze({
  live: createDataset("live"),
  test: createDataset("test"),
});

function assertEnvironment(expected: AdminEnvironmentId, received: AdminEnvironmentId): void {
  if (expected !== received) {
    throw new Error("Demo repository environment mismatch.");
  }
}

export function createFixtureAdminRepository(
  boundEnvironment: AdminEnvironmentId,
): AdminReadRepository {
  const dataset = DATASETS[boundEnvironment];

  return {
    getOverview(environment) {
      assertEnvironment(boundEnvironment, environment);
      return Promise.resolve(dataset.overview);
    },
    searchUsers(environment) {
      assertEnvironment(boundEnvironment, environment);
      return Promise.resolve(dataset.users);
    },
    getUserProfile(environment, userId) {
      assertEnvironment(boundEnvironment, environment);
      return Promise.resolve(dataset.profiles[userId] ?? null);
    },
    listPayments(environment) {
      assertEnvironment(boundEnvironment, environment);
      return Promise.resolve(dataset.payments);
    },
    getPayment(environment, paymentId) {
      assertEnvironment(boundEnvironment, environment);
      return Promise.resolve(
        dataset.payments.payments.find((payment) => payment.id === paymentId) ?? null,
      );
    },
    getAnalytics(environment) {
      assertEnvironment(boundEnvironment, environment);
      return Promise.resolve(dataset.analytics);
    },
    getSystemHealth(environment) {
      assertEnvironment(boundEnvironment, environment);
      return Promise.resolve(dataset.health);
    },
  };
}
