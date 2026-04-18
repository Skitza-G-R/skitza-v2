import { type Db, notifications } from "@skitza/db";

// Fire-and-forget notification inserts. Each emit helper inserts a
// single row into the `notifications` table for later display in the
// producer's unified inbox at /dashboard/inbox.
//
// IMPORTANT: callers should `await` these BUT wrap the call in a
// try/catch + console.warn so a notify failure never breaks the
// primary flow (the booking insert, the comment insert, the contract
// sign, etc.). The notification row is a side-effect — missing one
// is annoying but non-fatal; failing a booking insert because of a
// flaky notifications table is not acceptable.

export async function emitCommentCreated(db: Db, input: {
  producerId: string;
  commentId: string;
  trackVersionId: string;
  projectId: string | null;
  authorName: string;
  preview: string;
}): Promise<void> {
  await db.insert(notifications).values({
    producerId: input.producerId,
    kind: "comment_created",
    title: `New comment from ${input.authorName}`,
    // 280 char cap matches Twitter's original limit — enough for
    // context, short enough to render in a single list row.
    body: input.preview.slice(0, 280),
    projectId: input.projectId,
    trackVersionId: input.trackVersionId,
    commentId: input.commentId,
  });
}

export async function emitContractSigned(db: Db, input: {
  producerId: string;
  contractId: string;
  projectId: string | null;
  signerName: string;
  allSigned: boolean;
}): Promise<void> {
  await db.insert(notifications).values({
    producerId: input.producerId,
    kind: "contract_signed",
    title: input.allSigned ? "Contract fully signed" : `${input.signerName} signed`,
    body: input.allSigned ? "All parties have signed." : "Awaiting remaining signers.",
    contractId: input.contractId,
    projectId: input.projectId,
  });
}

export async function emitBookingRequested(db: Db, input: {
  producerId: string;
  bookingId: string;
  artistName: string;
  artistEmail: string;
  when: Date;
}): Promise<void> {
  const dateStr = input.when.toISOString().slice(0, 10);
  await db.insert(notifications).values({
    producerId: input.producerId,
    kind: "booking_requested",
    title: `${input.artistName} requested a session`,
    body: `For ${dateStr} — ${input.artistEmail}`,
    bookingId: input.bookingId,
  });
}
