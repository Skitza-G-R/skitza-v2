import { and, asc, betaInvitees, eq, inArray, type BetaInvitee, type Db } from "@skitza/db";

import type { ParsedBetaRow } from "./model";

// SK-273 — thin data access for the founder Beta page. Status *derivation*
// (signed_up / active) lives in @skitza/db's shared beta module; this
// repository only handles the founder-driven bookkeeping: importing the
// list, marking invitations sent, moving people between waves.

export function createBetaRepository(db: Db) {
  return {
    async importRows(
      rows: readonly ParsedBetaRow[],
      now: Date,
    ): Promise<Readonly<{ inserted: number; skipped: number }>> {
      if (rows.length === 0) return { inserted: 0, skipped: 0 };
      const inserted = await db
        .insert(betaInvitees)
        .values(
          rows.map((row) => ({
            createdAt: now,
            email: row.email,
            name: row.name,
            updatedAt: now,
            wave: row.wave,
          })),
        )
        .onConflictDoNothing({ target: betaInvitees.email })
        .returning({ id: betaInvitees.id });
      return { inserted: inserted.length, skipped: rows.length - inserted.length };
    },

    async listAll(): Promise<BetaInvitee[]> {
      return db
        .select()
        .from(betaInvitees)
        .orderBy(asc(betaInvitees.wave), asc(betaInvitees.email));
    },

    async listPendingEmailsInWave(wave: number): Promise<string[]> {
      const rows = await db
        .select({ email: betaInvitees.email })
        .from(betaInvitees)
        .where(and(eq(betaInvitees.wave, wave), eq(betaInvitees.status, "pending")))
        .orderBy(asc(betaInvitees.email));
      return rows.map((row) => row.email);
    },

    async findByEmail(email: string): Promise<BetaInvitee | null> {
      const rows = await db
        .select()
        .from(betaInvitees)
        .where(eq(betaInvitees.email, email))
        .limit(1);
      return rows[0] ?? null;
    },

    /**
     * Stamp an invitee as invited. Guarded to pending/invited so a re-send
     * can refresh `invitedAt` but a signed-up or active row never regresses.
     */
    async markInvited(email: string, now: Date): Promise<void> {
      await db
        .update(betaInvitees)
        .set({ invitedAt: now, status: "invited", updatedAt: now })
        .where(
          and(eq(betaInvitees.email, email), inArray(betaInvitees.status, ["pending", "invited"])),
        );
    },

    async setWave(email: string, wave: number, now: Date): Promise<boolean> {
      const updated = await db
        .update(betaInvitees)
        .set({ updatedAt: now, wave })
        .where(eq(betaInvitees.email, email))
        .returning({ id: betaInvitees.id });
      return updated.length > 0;
    },

    /** Delete a row. Only `pending` rows can go — history is never erased. */
    async removePending(email: string): Promise<boolean> {
      const removed = await db
        .delete(betaInvitees)
        .where(and(eq(betaInvitees.email, email), eq(betaInvitees.status, "pending")))
        .returning({ id: betaInvitees.id });
      return removed.length > 0;
    },
  };
}

export type BetaRepository = ReturnType<typeof createBetaRepository>;
