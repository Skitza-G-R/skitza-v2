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

// ─── Purchase flow (SK-37 / BE-1) ───────────────────────────────────
// Producer-facing inbox events for the artist purchase journey. Same
// fire-and-forget contract as the helpers above — callers wrap in
// try/catch so a notify failure never breaks the request/approve flow.

export async function emitPurchaseRequested(db: Db, input: {
  producerId: string;
  purchaseRequestId: string;
  artistName: string;
  artistEmail: string;
  productName: string;
  refNumber: string;
}): Promise<void> {
  await db.insert(notifications).values({
    producerId: input.producerId,
    kind: "purchase_requested",
    title: `${input.artistName} wants to buy ${input.productName}`,
    body: `${input.refNumber} — ${input.artistEmail}`,
    purchaseRequestId: input.purchaseRequestId,
  });
}

export async function emitPurchaseApproved(db: Db, input: {
  producerId: string;
  purchaseRequestId: string;
  artistName: string;
  productName: string;
  refNumber: string;
}): Promise<void> {
  await db.insert(notifications).values({
    producerId: input.producerId,
    kind: "purchase_approved",
    title: `You approved ${input.artistName}'s purchase`,
    body: `${input.refNumber} — ${input.productName}`,
    purchaseRequestId: input.purchaseRequestId,
  });
}

export async function emitPurchaseDeclined(db: Db, input: {
  producerId: string;
  purchaseRequestId: string;
  artistName: string;
  productName: string;
  refNumber: string;
  reason?: string | null;
}): Promise<void> {
  // The reason is producer-internal only — the artist always sees a
  // generic decline message (BE-1 success criteria).
  const body = input.reason
    ? `${input.refNumber} — ${input.productName} · ${input.reason}`
    : `${input.refNumber} — ${input.productName}`;
  await db.insert(notifications).values({
    producerId: input.producerId,
    kind: "purchase_declined",
    title: `You declined ${input.artistName}'s purchase`,
    body,
    purchaseRequestId: input.purchaseRequestId,
  });
}

export async function emitAgreementAccepted(db: Db, input: {
  producerId: string;
  purchaseRequestId: string;
  artistName: string;
  productName: string;
  refNumber: string;
}): Promise<void> {
  await db.insert(notifications).values({
    producerId: input.producerId,
    kind: "agreement_accepted",
    title: `${input.artistName} accepted the agreement`,
    body: `${input.refNumber} — ${input.productName}`,
    purchaseRequestId: input.purchaseRequestId,
  });
}

export async function emitProofSubmitted(db: Db, input: {
  proofId: string;
  producerId: string;
  purchaseId: string;
  projectId: string;
  artistName: string;
  productName: string;
  refNumber: string;
  amountCents: number;
  currency: string;
}): Promise<void> {
  const amount = `${input.currency === "ILS" ? "\u20aa" : ""}${(input.amountCents / 100).toLocaleString("en-US")}`;
  await db.insert(notifications).values({
    // Reuse the globally unique proof UUID so the notification has a durable
    // exact deep-link without requiring another production migration.
    id: input.proofId,
    producerId: input.producerId,
    kind: "proof_submitted",
    title: `${input.artistName} uploaded a proof of payment`,
    body: `${input.refNumber} \u2014 ${amount} \u00b7 ${input.productName}`,
    purchaseId: input.purchaseId,
    projectId: input.projectId,
  });
}
