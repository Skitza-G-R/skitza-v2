import { createHash } from "node:crypto";
import { clientContacts, type Db } from "@skitza/db";

// Upsert the (producerId, email) pair into the client contacts cache.
//
// Called from any surface that captures an artist's identity:
// - booking request submit (booking.ts)
// - contract recipient add (contract.ts — will wire on merge of that branch)
// - deal create / publicComment (deal.ts)
//
// Fire-and-forget in spirit: the caller awaits, but a failure here
// should NEVER break the main flow. Wrap the call in try/catch at the
// call site and log+continue.
//
// Email is normalized (trim + lowercase) before hashing so a returning
// artist hits the same row no matter how they cased/spaced their
// address. The raw lowercase is kept in the `email` column so UI can
// display it verbatim.
export async function recordContact(
  db: Db,
  input: { producerId: string; email: string; name: string },
): Promise<void> {
  const lowerEmail = input.email.trim().toLowerCase();
  // Silent skip on empty/invalid — don't bubble validation up into
  // the main flow. Server-side input schemas already enforce email
  // shape at the call sites; this is defense-in-depth.
  if (!lowerEmail || !lowerEmail.includes("@")) return;
  const emailHash = createHash("sha256").update(lowerEmail).digest("hex");
  const now = new Date();
  const trimmedName = input.name.trim();

  // Upsert: insert new, or update lastSeenAt + name on conflict. Name
  // is refreshed on re-contact because artists sometimes correct a
  // mistyped name on a second booking — we want the latest spelling.
  await db
    .insert(clientContacts)
    .values({
      producerId: input.producerId,
      emailHash,
      email: lowerEmail,
      name: trimmedName,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [clientContacts.producerId, clientContacts.emailHash],
      set: { name: trimmedName, lastSeenAt: now },
    });
}
