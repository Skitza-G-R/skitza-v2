import { eq, inArray, ne } from "drizzle-orm";
import { sql } from "drizzle-orm";

import type { Db } from "./client";
import { betaInvitees, producers, projects, type BetaInvitee } from "./schema";

// SK-273 — shared closed-beta logic. Both the founder admin console (status
// refresh on page load) and the apps/web nudge cron consume these helpers, so
// the "what counts as signed up / active / due a nudge" rules exist exactly
// once. Keep this module pure DB + pure functions: no Clerk, no email.

export const BETA_SIGNUP_REMINDER_AFTER_DAYS = 5;
export const BETA_ACTIVATION_HELP_AFTER_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type BetaNudgeKind = "signup_reminder" | "activation_help";

export type BetaStatusSyncPlan = Readonly<{
  markSignedUp: readonly string[];
  markActive: readonly string[];
}>;

/**
 * Decide which invitees move forward given database truth. Pure so the
 * transition rules are unit-testable without a database:
 * - an invitee whose email owns a producer with >=1 project becomes `active`
 *   (even straight from `pending` — truth wins over our bookkeeping);
 * - otherwise an invitee whose email owns a producer becomes `signed_up`;
 * - `active` rows never change, statuses never move backwards.
 */
export function planBetaStatusSync(
  invitees: readonly Pick<BetaInvitee, "id" | "email" | "status">[],
  producerEmails: ReadonlySet<string>,
  activeProducerEmails: ReadonlySet<string>,
): BetaStatusSyncPlan {
  const markSignedUp: string[] = [];
  const markActive: string[] = [];
  for (const invitee of invitees) {
    if (invitee.status === "active") continue;
    if (activeProducerEmails.has(invitee.email)) {
      markActive.push(invitee.id);
      continue;
    }
    if (invitee.status === "signed_up") continue;
    if (producerEmails.has(invitee.email)) markSignedUp.push(invitee.id);
  }
  return { markSignedUp, markActive };
}

/**
 * Refresh `signed_up` / `active` statuses from the producers and projects
 * tables. Reads every non-active invitee (the beta list is ~200 rows), plans
 * the transitions in memory, then applies at most three batched updates.
 */
export async function syncBetaInviteeStatuses(
  db: Db,
  now: Date,
): Promise<Readonly<{ activated: number; signedUp: number }>> {
  const invitees = await db
    .select({ email: betaInvitees.email, id: betaInvitees.id, status: betaInvitees.status })
    .from(betaInvitees)
    .where(ne(betaInvitees.status, "active"));
  if (invitees.length === 0) return { activated: 0, signedUp: 0 };

  const emails = [...new Set(invitees.map((invitee) => invitee.email))];
  const producerRows = await db
    .select({ email: sql<string>`lower(${producers.email})`, id: producers.id })
    .from(producers)
    .where(inArray(sql`lower(${producers.email})`, emails));
  if (producerRows.length === 0) return { activated: 0, signedUp: 0 };

  const producerIds = producerRows.map((producer) => producer.id);
  const activeRows = await db
    .selectDistinct({ producerId: projects.producerId })
    .from(projects)
    .where(inArray(projects.producerId, producerIds));
  const activeProducerIds = new Set(activeRows.map((row) => row.producerId));

  const producerEmails = new Set(producerRows.map((producer) => producer.email));
  const activeProducerEmails = new Set(
    producerRows
      .filter((producer) => activeProducerIds.has(producer.id))
      .map((producer) => producer.email),
  );

  const plan = planBetaStatusSync(invitees, producerEmails, activeProducerEmails);

  if (plan.markSignedUp.length > 0) {
    await db
      .update(betaInvitees)
      .set({ signedUpAt: now, status: "signed_up", updatedAt: now })
      .where(inArray(betaInvitees.id, [...plan.markSignedUp]));
  }
  if (plan.markActive.length > 0) {
    await db
      .update(betaInvitees)
      .set({ activatedAt: now, status: "active", updatedAt: now })
      .where(inArray(betaInvitees.id, [...plan.markActive]));
    // Rows that jumped straight from pending/invited still deserve a
    // signed-up stamp; rows that were already signed_up keep their original.
    await db
      .update(betaInvitees)
      .set({ signedUpAt: now })
      .where(inArray(betaInvitees.id, [...plan.markActive]));
  }

  return { activated: plan.markActive.length, signedUp: plan.markSignedUp.length };
}

export type BetaNudgeCandidate = Pick<
  BetaInvitee,
  | "activationHelpSentAt"
  | "email"
  | "id"
  | "invitedAt"
  | "name"
  | "signedUpAt"
  | "signupReminderSentAt"
  | "status"
>;

/**
 * Pick who is due a nudge right now. Each nudge fires at most once per
 * invitee, ever — a non-null sent stamp permanently blocks that nudge.
 */
export function selectBetaNudges(
  invitees: readonly BetaNudgeCandidate[],
  now: Date,
): Readonly<{
  activationHelp: readonly BetaNudgeCandidate[];
  signupReminders: readonly BetaNudgeCandidate[];
}> {
  const signupReminders: BetaNudgeCandidate[] = [];
  const activationHelp: BetaNudgeCandidate[] = [];
  for (const invitee of invitees) {
    if (
      invitee.status === "invited" &&
      invitee.invitedAt !== null &&
      invitee.signupReminderSentAt === null &&
      now.getTime() - invitee.invitedAt.getTime() >= BETA_SIGNUP_REMINDER_AFTER_DAYS * DAY_MS
    ) {
      signupReminders.push(invitee);
    }
    if (
      invitee.status === "signed_up" &&
      invitee.signedUpAt !== null &&
      invitee.activationHelpSentAt === null &&
      now.getTime() - invitee.signedUpAt.getTime() >= BETA_ACTIVATION_HELP_AFTER_DAYS * DAY_MS
    ) {
      activationHelp.push(invitee);
    }
  }
  return { activationHelp, signupReminders };
}

export async function listBetaNudgeCandidates(db: Db): Promise<BetaNudgeCandidate[]> {
  return db
    .select({
      activationHelpSentAt: betaInvitees.activationHelpSentAt,
      email: betaInvitees.email,
      id: betaInvitees.id,
      invitedAt: betaInvitees.invitedAt,
      name: betaInvitees.name,
      signedUpAt: betaInvitees.signedUpAt,
      signupReminderSentAt: betaInvitees.signupReminderSentAt,
      status: betaInvitees.status,
    })
    .from(betaInvitees)
    .where(inArray(betaInvitees.status, ["invited", "signed_up"]));
}

/** Stamp a nudge as sent. Called right after a successful email send. */
export async function markBetaNudgeSent(
  db: Db,
  inviteeId: string,
  kind: BetaNudgeKind,
  now: Date,
): Promise<void> {
  await db
    .update(betaInvitees)
    .set(
      kind === "signup_reminder"
        ? { signupReminderSentAt: now, updatedAt: now }
        : { activationHelpSentAt: now, updatedAt: now },
    )
    .where(eq(betaInvitees.id, inviteeId));
}
