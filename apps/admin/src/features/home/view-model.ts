// SK-288 — the founder Home screen's shape.
//
// Home answers one question: what is broken, and who is waiting on Gili.
// Every row is a real count from a table something in production actually
// writes. A row that could only ever read zero was deleted rather than
// built — a permanent zero reads as "healthy" during an outage, which is
// the exact failure SK-287 and SK-282 were found by accident because of.
//
// An empty Home is the success state, not an empty state to apologise for.

export type HomeSignals = Readonly<{
  betaInvitesWithoutSignup: number;
  failedInvitationEmails: number;
  failedReminderEmails: number;
  onboardingIncomplete: number;
}>;

export type HomeRow = Readonly<{
  id: string;
  tone: "broken" | "waiting";
  label: string;
  count: number;
  /**
   * Omitted when admin has no screen that shows this row's detail. A row
   * that links somewhere it cannot explain itself is worse than a row that
   * links nowhere.
   */
  href?: string;
  /** Where to act when the answer is not a screen in this console. */
  hint?: string;
}>;

export type HomeView = Readonly<{ quiet: boolean; rows: readonly HomeRow[] }>;

export function buildHomeView(signals: HomeSignals): HomeView {
  const candidates: readonly HomeRow[] = [
    {
      count: signals.failedInvitationEmails,
      hint: "The provider refused these. Check the email provider, then the producer can resend.",
      id: "failed-invitation-emails",
      label: "Invitation emails that failed to send",
      tone: "broken",
    },
    {
      count: signals.failedReminderEmails,
      hint: "Nothing retries these. The producer has to send the reminder again.",
      id: "failed-reminder-emails",
      label: "Payment reminders that failed to send",
      tone: "broken",
    },
    {
      count: signals.onboardingIncomplete,
      href: "/users?onboarding=not-complete",
      id: "onboarding-incomplete",
      label: "Producers who never finished setting up",
      tone: "waiting",
    },
    {
      count: signals.betaInvitesWithoutSignup,
      href: "/beta",
      id: "beta-invites-without-signup",
      label: "Beta invites with no signup after a week",
      tone: "waiting",
    },
  ];

  const rows = candidates.filter((row) => row.count > 0);
  return { quiet: rows.length === 0, rows };
}
