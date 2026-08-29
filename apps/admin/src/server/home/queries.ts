import {
  and,
  betaInvitees,
  clientInvitationEmailDeliveries,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  or,
  purchaseReminderDeliveries,
  sql,
  type Db,
} from "@skitza/db";

import type { HomeSignals } from "~/features/home/view-model";
import type { RegisteredUserRepository } from "~/server/registered-users/service";
import { parseRegisteredUserDirectoryQuery } from "~/server/registered-users/model";

// SK-288 — the counts behind the founder Home screen.
//
// Two rules govern everything in this file.
//
// 1. `purchase_reminder_deliveries` has NO 'failed' status. Its only values
//    are reserved | sending | sent | reservation_expired | dedupe_expired.
//    A failed send is recorded by stamping `last_failed_at` and returning
//    the row to 'reserved'; a crash mid-send leaves it 'sending' past its
//    claim. `completeDelivery` does not clear `last_failed_at`, so the
//    status must be pinned or a reminder that failed once and then went out
//    would still be counted. `client_invitation_email_deliveries` is a
//    different table and does have a real 'failed' status.
//
// 2. None of these tables carry an `admin_data_environment` column. Live and
//    Test are separated by connecting to a different database, not by
//    filtering a column. The six tables that DO carry that column
//    (system_problems, operational_runs, admin_action_history,
//    admin_action_receipts, admin_support_notes, domain_events) are not read
//    here, and queries.test.ts fails if that ever changes without a
//    `environment = 'live'` filter alongside it.

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;

function sevenDaysBefore(now: Date): Date {
  return new Date(now.getTime() - SEVEN_DAYS_MS);
}

/**
 * Producer-to-client invitation emails the provider refused. `failed` clears
 * itself: a retry reclaims the row to 'sending' and a success moves it to
 * 'provider_accepted', so a row still sitting at 'failed' means the last
 * attempt failed and nobody has fixed it.
 */
export function failedInvitationEmailsQuery(db: Db, now: Date) {
  return db
    .select({ total: sql<number>`count(*)::int` })
    .from(clientInvitationEmailDeliveries)
    .where(
      and(
        eq(clientInvitationEmailDeliveries.status, "failed"),
        gte(clientInvitationEmailDeliveries.updatedAt, sevenDaysBefore(now)),
      ),
    );
}

/**
 * Payment reminders that did not go out. Both halves are needed: an ordinary
 * provider refusal returns the row to 'reserved' with `last_failed_at`
 * stamped, while only a hard process death leaves one stranded in 'sending'.
 * Rows that later succeeded are excluded by pinning the status.
 */
export function failedReminderEmailsQuery(db: Db, now: Date) {
  return db
    .select({ total: sql<number>`count(*)::int` })
    .from(purchaseReminderDeliveries)
    .where(
      and(
        gte(purchaseReminderDeliveries.updatedAt, sevenDaysBefore(now)),
        or(
          and(
            eq(purchaseReminderDeliveries.status, "reserved"),
            isNotNull(purchaseReminderDeliveries.lastFailedAt),
          ),
          and(
            eq(purchaseReminderDeliveries.status, "sending"),
            lt(purchaseReminderDeliveries.claimUntil, now),
          ),
        ),
      ),
    );
}

/**
 * People invited to the beta over a week ago who still have not signed up.
 * A row never invited has a null `invited_at`, so the comparison excludes it.
 */
export function betaInvitesWithoutSignupQuery(db: Db, now: Date) {
  return db
    .select({ total: sql<number>`count(*)::int` })
    .from(betaInvitees)
    .where(and(isNull(betaInvitees.signedUpAt), lt(betaInvitees.invitedAt, sevenDaysBefore(now))));
}

async function countOf(query: { execute: () => Promise<{ total: number }[]> }): Promise<number> {
  const rows = await query.execute();
  return rows[0]?.total ?? 0;
}

/**
 * Home reuses the Users directory for anything about people rather than
 * writing a second definition of "finished onboarding". The filtered path
 * returns a filtered `totalCount`; the unfiltered default path does not,
 * which is why the onboarding filter is always applied.
 */
export async function loadHomeSignals(
  db: Db,
  registeredUsers: RegisteredUserRepository,
  now: Date = new Date(),
): Promise<HomeSignals> {
  const [betaInvitesWithoutSignup, failedInvitationEmails, failedReminderEmails, directory] =
    await Promise.all([
      countOf(betaInvitesWithoutSignupQuery(db, now)),
      countOf(failedInvitationEmailsQuery(db, now)),
      countOf(failedReminderEmailsQuery(db, now)),
      registeredUsers.findDirectory(
        parseRegisteredUserDirectoryQuery({ onboarding: "not-complete" }),
      ),
    ]);

  return {
    betaInvitesWithoutSignup,
    failedInvitationEmails,
    failedReminderEmails,
    onboardingIncomplete: directory.totalCount,
  };
}
