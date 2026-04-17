// Contract router — PDF-editor + signer workflow.
//
// Twelve procedures split roughly in half: producer-authenticated CRUD
// over contracts/recipients/fields, and public (token-gated) endpoints
// the signer hits from their signing link. Follows the same token-
// discipline as project.ts and magic-link.ts: raw token shown ONCE on
// creation, only sha256(token) persisted, hash-compared on every
// signer call.
//
// B.5 replaces the flatten-stub at the bottom of publicSign with the
// real PKCS#7 sealing pipeline. Until then, when all recipients sign
// the contract advances to `signed` and STAYS there; it does NOT
// advance to `completed` or populate finalPdfR2Key.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { TRPCError } from "@trpc/server";
import {
  and,
  contractEvents,
  contractFields,
  contractRecipients,
  contracts,
  createDb,
  desc,
  eq,
  type Db,
} from "@skitza/db";
import { z } from "zod";

import { publicProcedure, router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { BUCKETS, getR2 } from "~/server/storage/r2";

// ─── Helpers ─────────────────────────────────────────────────────────
async function publicCtx(): Promise<{ db: Db; ipHash: string; userAgent: string }> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "missing DATABASE_URL" });
  }
  const hdrs = await headers();
  const ipRaw = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = hdrs.get("user-agent") ?? "unknown";
  return {
    db: createDb(dbUrl),
    ipHash: createHash("sha256").update(ipRaw).digest("hex"),
    userAgent,
  };
}

// 32 bytes → 43-char base64url signing token. Only the hash is stored.
function mintToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Every contract-mutating path writes to the audit trail. `event` is a
// pg enum so we list the values inline here rather than re-importing a
// drizzle enum helper.
type EventKind =
  | "created"
  | "sent"
  | "viewed"
  | "field_filled"
  | "signed"
  | "completed"
  | "cancelled"
  | "downloaded";

async function logEvent(
  db: Db,
  input: {
    contractId: string;
    recipientId?: string | null;
    event: EventKind;
    ipHash?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(contractEvents).values({
    contractId: input.contractId,
    recipientId: input.recipientId ?? null,
    event: input.event,
    ipHash: input.ipHash ?? null,
    userAgent: input.userAgent ?? null,
    metadata: input.metadata ?? null,
  });
}

// Ownership walk — contract belongs to the calling producer.
async function assertOwnsContract(
  ctx: { db: Db; producerId: string },
  contractId: string,
): Promise<void> {
  const [row] = await ctx.db
    .select({ producerId: contracts.producerId })
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Contract not found" });
  if (row.producerId !== ctx.producerId) throw new TRPCError({ code: "FORBIDDEN" });
}

// numeric(5,2) columns come back as string from drizzle/pg. Clamp
// precision on the way IN so we never send garbage like 33.333333.
function pct(n: number): string {
  return n.toFixed(2);
}

// Sanitise a filename for R2 keys. Same rules as r2.ts#sanitize but
// inlined here because we build the key manually (no contractId yet
// at uploadPdf time).
function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.\.+/g, "_");
  if (!cleaned || /^_+$/.test(cleaned)) return "upload.pdf";
  return cleaned;
}

// ─── Inputs ──────────────────────────────────────────────────────────
const FieldInput = z.object({
  id: z.string().uuid().optional(),
  page: z.number().int().min(1),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  w: z.number().min(0.1).max(100),
  h: z.number().min(0.1).max(100),
  type: z.enum(["signature", "initial", "date", "text", "checkbox", "dropdown", "number"]),
  recipientId: z.string().uuid().nullable().optional(),
  required: z.boolean().optional(),
  prefilledValue: z.string().nullable().optional(),
  options: z.record(z.unknown()).nullable().optional(),
});

// ─── Router ──────────────────────────────────────────────────────────
export const contractRouter = router({
  // 1. Presigned PUT URL for the uploaded PDF (5-minute TTL, single
  //    part — contracts are small). Returns a pending key that
  //    createDraft will attach to a new contracts row. We mint a
  //    pendingId rather than using the eventual contractId because the
  //    row doesn't exist yet.
  uploadPdf: producerProcedure
    .input(
      z.object({
        filename: z
          .string()
          .min(1)
          .max(255)
          .refine((s) => s.toLowerCase().endsWith(".pdf"), "Filename must end with .pdf"),
        sizeBytes: z
          .number()
          .int()
          .positive()
          .max(50 * 1024 * 1024, "PDF too large. Max 50MB."),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const pendingId = randomUUID();
      const key = `producers/${ctx.producerId}/contracts/pending/${pendingId}/${sanitizeFilename(input.filename)}`;
      const cmd = new PutObjectCommand({
        Bucket: BUCKETS.docs,
        Key: key,
        ContentType: "application/pdf",
      });
      const url = await getSignedUrl(getR2(), cmd, { expiresIn: 300 });
      return { key, url };
    }),

  // 2. Create a draft row from an already-uploaded PDF key. Ownership
  //    is enforced via the key prefix — the key was minted server-side
  //    by uploadPdf, so its prefix is a trusted-origin handle.
  createDraft: producerProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        pdfR2Key: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.pdfR2Key.startsWith(`producers/${ctx.producerId}/contracts/`)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "PDF key doesn't belong to you" });
      }
      const [row] = await ctx.db
        .insert(contracts)
        .values({
          producerId: ctx.producerId,
          title: input.title,
          pdfR2Key: input.pdfR2Key,
          status: "draft",
        })
        .returning({ id: contracts.id });
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await logEvent(ctx.db, { contractId: row.id, event: "created" });
      return { id: row.id };
    }),

  // 3. Summary list for the producer dashboard. No joins — detail()
  //    fetches recipients + fields.
  list: producerProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(contracts)
      .where(eq(contracts.producerId, ctx.producerId))
      .orderBy(desc(contracts.createdAt));
  }),

  // 4. Full detail — contract row + all recipients + all fields.
  //    signingTokenHash is stripped from recipients on the way out:
  //    the hash is useless to the client and exposing it would let a
  //    DB-leaked hash be correlated back to a recipient id.
  detail: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertOwnsContract(ctx, input.id);
      const [contract] = await ctx.db
        .select()
        .from(contracts)
        .where(eq(contracts.id, input.id))
        .limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND" });
      const [recipients, fields] = await Promise.all([
        ctx.db
          .select()
          .from(contractRecipients)
          .where(eq(contractRecipients.contractId, input.id)),
        ctx.db
          .select()
          .from(contractFields)
          .where(eq(contractFields.contractId, input.id)),
      ]);
      const safeRecipients = recipients.map((r) => ({
        id: r.id,
        contractId: r.contractId,
        email: r.email,
        name: r.name,
        role: r.role,
        routingOrder: r.routingOrder,
        viewedAt: r.viewedAt,
        signedAt: r.signedAt,
        ipHash: r.ipHash,
        userAgent: r.userAgent,
        createdAt: r.createdAt,
      }));
      return { contract, recipients: safeRecipients, fields };
    }),

  // 5. Idempotent bulk upsert of fields for a contract. The editor
  //    sends the FULL current field set every save; we diff by id:
  //    existing-with-id → update, missing-from-payload → delete,
  //    no-id → insert. Delete-then-insert would be simpler but blows
  //    away FK references in contractEvents.metadata (B.5 may care).
  //
  //    Coord validation: each rect must fit inside the page (0..100%
  //    in both axes). Drizzle's numeric type is string-typed on the
  //    TS side so we pct() through toFixed(2).
  saveFields: producerProcedure
    .input(
      z.object({
        contractId: z.string().uuid(),
        fields: z.array(FieldInput),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOwnsContract(ctx, input.contractId);
      // Validate coords — must stay inside page.
      for (const f of input.fields) {
        if (f.x + f.w > 100.01 || f.y + f.h > 100.01) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Field on page ${String(f.page)} at (${String(f.x)}, ${String(f.y)}) extends past the page edge.`,
          });
        }
      }

      const existing = await ctx.db
        .select({ id: contractFields.id })
        .from(contractFields)
        .where(eq(contractFields.contractId, input.contractId));
      const existingIds = new Set(existing.map((e) => e.id));
      const keepIds = new Set(
        input.fields.filter((f) => f.id !== undefined).map((f) => f.id as string),
      );

      // Pre-flight: any f.id that's provided must belong to THIS contract.
      // Reject before we mutate anything so a bad payload can't leave the
      // DB in a partially-applied state (e.g. deletes already fired).
      for (const f of input.fields) {
        if (f.id !== undefined && !existingIds.has(f.id)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Field id does not belong to this contract.",
          });
        }
      }

      // Delete fields no longer in payload.
      for (const row of existing) {
        if (!keepIds.has(row.id)) {
          await ctx.db.delete(contractFields).where(eq(contractFields.id, row.id));
        }
      }

      // Upsert remaining.
      for (const f of input.fields) {
        const base = {
          contractId: input.contractId,
          recipientId: f.recipientId ?? null,
          page: f.page,
          x: pct(f.x),
          y: pct(f.y),
          w: pct(f.w),
          h: pct(f.h),
          type: f.type,
          required: f.required ?? true,
          prefilledValue: f.prefilledValue ?? null,
          options: f.options ?? null,
        };
        if (f.id === undefined) {
          await ctx.db.insert(contractFields).values(base);
        } else if (existingIds.has(f.id)) {
          await ctx.db
            .update(contractFields)
            .set(base)
            .where(eq(contractFields.id, f.id));
        } else {
          // Pre-flight above already rejected this case; defensive guard
          // keeps the branch exhaustive without silent fall-through.
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Field id does not belong to this contract.",
          });
        }
      }

      // Touch parent so list views reflect activity.
      await ctx.db
        .update(contracts)
        .set({ updatedAt: new Date() })
        .where(eq(contracts.id, input.contractId));

      const updated = await ctx.db
        .select()
        .from(contractFields)
        .where(eq(contractFields.contractId, input.contractId));
      return { fields: updated };
    }),

  // 6. Add a recipient. Returns the raw signing token ONCE — caller
  //    must persist/share it immediately (store in hashed form or
  //    build the signing URL right away). We only keep sha256(token).
  addRecipient: producerProcedure
    .input(
      z.object({
        contractId: z.string().uuid(),
        email: z.string().email(),
        name: z.string().min(1).max(200),
        role: z.string().default("signer"),
        routingOrder: z.number().int().positive().default(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOwnsContract(ctx, input.contractId);
      const token = mintToken();
      const [row] = await ctx.db
        .insert(contractRecipients)
        .values({
          contractId: input.contractId,
          email: input.email.toLowerCase(),
          name: input.name,
          role: input.role,
          routingOrder: input.routingOrder,
          signingTokenHash: token.hash,
        })
        .returning({ id: contractRecipients.id });
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return { id: row.id, signingToken: token.raw };
    }),

  // 7. Remove a recipient. Ownership walk: recipient → contract →
  //    producer.
  removeRecipient: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [r] = await ctx.db
        .select({ contractId: contractRecipients.contractId })
        .from(contractRecipients)
        .where(eq(contractRecipients.id, input.id))
        .limit(1);
      if (!r) throw new TRPCError({ code: "NOT_FOUND" });
      await assertOwnsContract(ctx, r.contractId);
      await ctx.db
        .delete(contractRecipients)
        .where(eq(contractRecipients.id, input.id));
      return { ok: true as const };
    }),

  // 8. Transition draft → sent. Validates that the contract is sendable:
  //    at least one recipient, every recipient has at least one required
  //    field assigned. Logs a per-recipient "sent" event so the audit
  //    trail captures who was notified.
  send: producerProcedure
    .input(z.object({ contractId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnsContract(ctx, input.contractId);
      const [c] = await ctx.db
        .select()
        .from(contracts)
        .where(eq(contracts.id, input.contractId))
        .limit(1);
      if (!c) throw new TRPCError({ code: "NOT_FOUND" });
      if (c.status !== "draft") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Contract is ${c.status}, can't send.`,
        });
      }
      const recipients = await ctx.db
        .select()
        .from(contractRecipients)
        .where(eq(contractRecipients.contractId, input.contractId));
      if (recipients.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add at least one signer first.",
        });
      }
      const fields = await ctx.db
        .select()
        .from(contractFields)
        .where(eq(contractFields.contractId, input.contractId));
      for (const r of recipients) {
        const hasField = fields.some((f) => f.recipientId === r.id && f.required);
        if (!hasField) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${r.name} has no required fields assigned. Add at least one signature or field for each signer.`,
          });
        }
      }
      const now = new Date();
      await ctx.db
        .update(contracts)
        .set({ status: "sent", sentAt: now, updatedAt: now })
        .where(eq(contracts.id, input.contractId));
      for (const r of recipients) {
        await logEvent(ctx.db, {
          contractId: input.contractId,
          recipientId: r.id,
          event: "sent",
        });
      }
      return { ok: true as const, recipientCount: recipients.length };
    }),

  // 9. Cancel from any non-terminal state. Completed/cancelled are
  //    terminal — rejecting re-cancel makes the audit trail cleaner.
  cancel: producerProcedure
    .input(z.object({ contractId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnsContract(ctx, input.contractId);
      const [c] = await ctx.db
        .select()
        .from(contracts)
        .where(eq(contracts.id, input.contractId))
        .limit(1);
      if (!c) throw new TRPCError({ code: "NOT_FOUND" });
      if (c.status === "completed" || c.status === "cancelled") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Contract is already ${c.status}.`,
        });
      }
      const now = new Date();
      await ctx.db
        .update(contracts)
        .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
        .where(eq(contracts.id, input.contractId));
      await logEvent(ctx.db, { contractId: input.contractId, event: "cancelled" });
      return { ok: true as const };
    }),

  // 10. Signer's view endpoint. Auto-advances sent → viewed on FIRST
  //     contract-level view, and records per-recipient viewedAt/ipHash/
  //     userAgent on first recipient view. Fields returned include any
  //     sender-prefilled ones (recipientId = null) so e.g. pre-typed
  //     dates/names render for every signer. signedValue from OTHER
  //     signers is visible too — intentional, so subsequent signers see
  //     what the contract looks like after earlier signatures.
  //
  //     Marked as mutation because we write to the DB (viewedAt,
  //     events); query would be cleaner semantically but it's a
  //     classic tRPC gotcha — queries must stay pure.
  publicByToken: publicProcedure
    .input(z.object({ token: z.string().min(10).max(200) }))
    .mutation(async ({ input }) => {
      const hash = hashToken(input.token);
      const { db, ipHash, userAgent } = await publicCtx();
      const [recipient] = await db
        .select()
        .from(contractRecipients)
        .where(eq(contractRecipients.signingTokenHash, hash))
        .limit(1);
      if (!recipient) throw new TRPCError({ code: "NOT_FOUND" });
      const [contract] = await db
        .select()
        .from(contracts)
        .where(eq(contracts.id, recipient.contractId))
        .limit(1);
      if (!contract) throw new TRPCError({ code: "NOT_FOUND" });
      if (contract.status === "cancelled" || contract.status === "expired") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Contract is ${contract.status}.`,
        });
      }

      // Auto-advance sent → viewed on first view anywhere.
      let effectiveStatus = contract.status;
      let effectiveViewedAt = contract.viewedAt;
      if (contract.status === "sent" && !contract.viewedAt) {
        const now = new Date();
        await db
          .update(contracts)
          .set({ status: "viewed", viewedAt: now, updatedAt: now })
          .where(eq(contracts.id, contract.id));
        effectiveStatus = "viewed";
        effectiveViewedAt = now;
      }
      // Record per-recipient first view separately (so we know which
      // of several signers opened the link first).
      if (!recipient.viewedAt) {
        await db
          .update(contractRecipients)
          .set({ viewedAt: new Date(), ipHash, userAgent })
          .where(eq(contractRecipients.id, recipient.id));
        await logEvent(db, {
          contractId: contract.id,
          recipientId: recipient.id,
          event: "viewed",
          ipHash,
          userAgent,
        });
      }

      // All fields for the contract — the client filters for "mine"
      // vs "informational" based on recipientId.
      const fields = await db
        .select()
        .from(contractFields)
        .where(eq(contractFields.contractId, contract.id));

      const pdfGetUrl = await getSignedUrl(
        getR2(),
        new GetObjectCommand({ Bucket: BUCKETS.docs, Key: contract.pdfR2Key }),
        { expiresIn: 900 },
      );

      return {
        contract: {
          id: contract.id,
          title: contract.title,
          status: effectiveStatus,
          viewedAt: effectiveViewedAt,
          pdfUrl: pdfGetUrl,
        },
        recipient: {
          id: recipient.id,
          name: recipient.name,
          email: recipient.email,
          signedAt: recipient.signedAt,
        },
        fields: fields.map((f) => ({
          id: f.id,
          page: f.page,
          x: Number(f.x),
          y: Number(f.y),
          w: Number(f.w),
          h: Number(f.h),
          type: f.type,
          required: f.required,
          recipientId: f.recipientId,
          prefilledValue: f.prefilledValue,
          signedValue: f.signedValue,
          options: f.options,
        })),
      };
    }),

  // 11. Recipient fills a single field value. Per-field validation is
  //     minimal here (signature/initial must be a data URL); deeper
  //     type-specific validation lands in B.7 alongside the flatten
  //     pipeline. The value cap is generous (5MB) to accommodate
  //     signature PNG data URLs drawn on hi-DPI canvases.
  publicFillField: publicProcedure
    .input(
      z.object({
        token: z.string().min(10).max(200),
        fieldId: z.string().uuid(),
        value: z.string().max(5_000_000),
      }),
    )
    .mutation(async ({ input }) => {
      const hash = hashToken(input.token);
      const { db, ipHash, userAgent } = await publicCtx();
      const [recipient] = await db
        .select()
        .from(contractRecipients)
        .where(eq(contractRecipients.signingTokenHash, hash))
        .limit(1);
      if (!recipient) throw new TRPCError({ code: "NOT_FOUND" });
      const [field] = await db
        .select()
        .from(contractFields)
        .where(eq(contractFields.id, input.fieldId))
        .limit(1);
      if (!field) throw new TRPCError({ code: "NOT_FOUND" });
      if (field.contractId !== recipient.contractId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (field.recipientId !== recipient.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This field isn't yours to fill.",
        });
      }
      if (recipient.signedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You've already signed.",
        });
      }

      if (
        (field.type === "signature" || field.type === "initial") &&
        !/^data:image\/(png|jpeg);base64,/.test(input.value)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Signature must be a drawn image.",
        });
      }

      await db
        .update(contractFields)
        .set({ signedValue: input.value, signedAt: new Date() })
        .where(eq(contractFields.id, input.fieldId));
      await logEvent(db, {
        contractId: recipient.contractId,
        recipientId: recipient.id,
        event: "field_filled",
        ipHash,
        userAgent,
        metadata: { fieldId: input.fieldId },
      });
      return { ok: true as const };
    }),

  // 12. Mark the recipient as signed. If they were the LAST required
  //     signer, advance the contract to `signed` (not `completed` —
  //     that waits on the flatten job in B.5). A `completed` status
  //     plus finalPdfR2Key is the contract that flatten produces.
  publicSign: publicProcedure
    .input(z.object({ token: z.string().min(10).max(200) }))
    .mutation(async ({ input }) => {
      const hash = hashToken(input.token);
      const { db, ipHash, userAgent } = await publicCtx();
      const [recipient] = await db
        .select()
        .from(contractRecipients)
        .where(eq(contractRecipients.signingTokenHash, hash))
        .limit(1);
      if (!recipient) throw new TRPCError({ code: "NOT_FOUND" });
      if (recipient.signedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You've already signed.",
        });
      }
      const fields = await db
        .select()
        .from(contractFields)
        .where(
          and(
            eq(contractFields.contractId, recipient.contractId),
            eq(contractFields.recipientId, recipient.id),
          ),
        );
      for (const f of fields) {
        if (f.required && !f.signedValue) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Please fill all required fields before signing.",
          });
        }
      }
      const now = new Date();
      await db
        .update(contractRecipients)
        .set({ signedAt: now, ipHash, userAgent })
        .where(eq(contractRecipients.id, recipient.id));
      await logEvent(db, {
        contractId: recipient.contractId,
        recipientId: recipient.id,
        event: "signed",
        ipHash,
        userAgent,
      });

      // Check if every recipient is now signed. We or-in the current
      // recipient because the freshly-set signedAt may not be visible
      // to the SELECT depending on session isolation.
      const all = await db
        .select()
        .from(contractRecipients)
        .where(eq(contractRecipients.contractId, recipient.contractId));
      const allSigned = all.every((r) => r.signedAt || r.id === recipient.id);
      if (allSigned) {
        await db
          .update(contracts)
          .set({ status: "signed", signedAt: now, updatedAt: now })
          .where(eq(contracts.id, recipient.contractId));
        await logEvent(db, { contractId: recipient.contractId, event: "signed" });
        // TODO(B.5): Enqueue flatten+seal job: await flattenAndSeal(recipient.contractId);
        // After flatten completes, status advances to "completed" and finalPdfR2Key is set.
      }
      return { ok: true as const, allSigned };
    }),
});
