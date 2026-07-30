import {
  adminSupportNotes,
  and,
  eq,
  registeredAccounts,
  type Db,
  type FoundationEnvironment,
} from "@skitza/db";

import {
  purgeAdminHistoryInTransaction,
  recordSensitiveRevealInTransaction,
} from "~/server/data-foundation/repository";
import {
  buildRecordSensitiveRevealCommand,
  type SensitiveRevealReason,
} from "~/server/data-foundation/service";

export class RegisteredUserRevealError extends Error {
  constructor() {
    super("REGISTERED_USER_REVEAL_NOT_FOUND");
    this.name = "RegisteredUserRevealError";
  }
}

export function createRegisteredUserSensitiveRevealService(input: Readonly<{
  database: Db;
  environment: FoundationEnvironment;
  now?: () => Date;
}>) {
  const now = input.now ?? (() => new Date());
  return Object.freeze({
    async revealSupportNote(command: Readonly<{
      actorClerkUserId: string;
      clerkUserId: string;
      noteId: string;
      operationKey: string;
      reason: SensitiveRevealReason;
    }>) {
      if (
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(command.clerkUserId) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          command.noteId,
        )
      ) {
        throw new RegisteredUserRevealError();
      }

      return input.database.transaction(async (transaction) => {
        const [account] = await transaction
          .select({
            clerkUserId: registeredAccounts.clerkUserId,
            providerState: registeredAccounts.providerState,
          })
          .from(registeredAccounts)
          .where(eq(registeredAccounts.clerkUserId, command.clerkUserId))
          .limit(1)
          .for("share");
        if (!account || account.providerState === "deleted") {
          throw new RegisteredUserRevealError();
        }

        // Prove the exact environment+account+note relationship without
        // selecting private content.
        const [authorizedNote] = await transaction
          .select({ id: adminSupportNotes.id })
          .from(adminSupportNotes)
          .where(
            and(
              eq(adminSupportNotes.id, command.noteId),
              eq(adminSupportNotes.environment, input.environment),
              eq(adminSupportNotes.targetType, "registered_account"),
              eq(adminSupportNotes.targetId, command.clerkUserId),
            ),
          )
          .limit(1)
          .for("share");
        if (!authorizedNote) throw new RegisteredUserRevealError();

        await purgeAdminHistoryInTransaction(transaction, input.environment);

        // noteId and account ID are both part of the canonical audit digest.
        // A reused operation key for another note conflicts before content is
        // selected.
        const audit = await recordSensitiveRevealInTransaction(
          transaction,
          input.environment,
          buildRecordSensitiveRevealCommand(
            {
              actorClerkUserId: command.actorClerkUserId,
              contentKind: "support_note",
              environment: input.environment,
              operationKey: command.operationKey,
              reason: command.reason,
              targetAccountClerkUserId: command.clerkUserId,
              targetId: command.noteId,
              targetType: "registered_account_support_note",
            },
            now(),
          ),
        );

        // Private content is selected only after the exact audit claim has
        // committed inside this same transaction.
        const [note] = await transaction
          .select({
            body: adminSupportNotes.body,
            createdAt: adminSupportNotes.createdAt,
          })
          .from(adminSupportNotes)
          .where(
            and(
              eq(adminSupportNotes.id, command.noteId),
              eq(adminSupportNotes.environment, input.environment),
              eq(adminSupportNotes.targetType, "registered_account"),
              eq(adminSupportNotes.targetId, command.clerkUserId),
            ),
          )
          .limit(1);
        if (!note) throw new RegisteredUserRevealError();

        return {
          auditId: audit.id,
          body: note.body,
          createdAt: note.createdAt,
          replayed: audit.replayed,
        };
      });
    },
  });
}
