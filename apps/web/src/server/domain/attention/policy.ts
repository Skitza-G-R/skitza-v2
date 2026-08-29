import {
  DISMISSIBLE_KINDS,
  type DismissibleKind,
} from "~/components/dashboard/overview/needs-you";

/**
 * SK-284 — who may hide what in the producer's "Needs you" queue.
 *
 * A dismissal is stored as a timestamp, never a flag: `isDismissed` in
 * `needs-you.ts` hides a row only while the stored `dismissedAt` is at least as
 * new as the subject's last real change. The row therefore reappears by itself
 * the next time the subject moves, and no cron, upload handler, or booking
 * transition has to remember to clear anything.
 *
 * This module owns the one rule the storage layer cannot express on its own:
 * which rows a producer is allowed to hide at all.
 */

export class AttentionPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttentionPolicyError";
  }
}

/**
 * Money and time-boxed decisions are never hideable. A payment proof, a due
 * balance and a purchase request are all money; a session request expires on a
 * 48-hour clock and cancels silently overnight. Hiding any of them would make
 * "Nothing needs you right now" untrue, so they are refused here as well as by
 * the CHECK on `producer_attention_dismissals.item_kind`.
 */
export function isDismissibleKind(value: string): value is DismissibleKind {
  return (DISMISSIBLE_KINDS as readonly string[]).includes(value);
}

/** Throws unless `value` names a row the producer may hide. */
export function assertDismissibleKind(value: string): DismissibleKind {
  if (!isDismissibleKind(value)) {
    throw new AttentionPolicyError(
      `"${value}" cannot be dismissed. Only ${DISMISSIBLE_KINDS.join(", ")} may be hidden.`,
    );
  }
  return value;
}
