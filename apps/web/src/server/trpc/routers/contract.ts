import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { TRPCError } from "@trpc/server";
import {
  asc,
  bookings,
  contractEvents,
  contractTemplates,
  contracts,
  createDb,
  desc,
  eq,
  producers,
  type Db,
} from "@skitza/db";
import { z } from "zod";

import { publicProcedure, router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { stripUndefined } from "../strip-undefined";

// ─── Helpers ─────────────────────────────────────────────────────────
async function publicCtx(): Promise<{ db: Db; ipHash: string; userAgent: string | null }> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "missing DATABASE_URL" });
  }
  const hdrs = await headers();
  const ipRaw = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return {
    db: createDb(dbUrl),
    ipHash: createHash("sha256").update(ipRaw).digest("hex"),
    userAgent: hdrs.get("user-agent"),
  };
}

function mintToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

// Escape HTML in user-provided merge values so a {{artistName}} with
// "<script>..." can't render as live markup.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Resolve {{placeholder}} tokens in a template body. Keys are the
// merge-field names we support; missing keys render as literal
// "{{name}}" so producers can spot bad refs.
function resolveMergeFields(
  body: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key: string) => {
    const v = vars[key];
    if (v === null || v === undefined || v === "") return match;
    return escapeHtml(String(v));
  });
}

// Small audit helper: log an event + update the parent contract if the
// event represents a status transition (viewed → status=viewed, etc.).
async function logEvent(
  db: Db,
  args: {
    contractId: string;
    kind: "created" | "sent" | "viewed" | "signed" | "downloaded" | "cancelled";
    ipHash?: string;
    userAgent?: string | null;
  },
): Promise<void> {
  await db.insert(contractEvents).values({
    contractId: args.contractId,
    kind: args.kind,
    ...(args.ipHash ? { ipHash: args.ipHash } : {}),
    ...(args.userAgent ? { userAgent: args.userAgent } : {}),
  });
}

// ─── Inputs ──────────────────────────────────────────────────────────
const TemplateInput = z.object({
  name: z.string().min(1).max(120),
  body: z.string().min(1).max(20_000),
});

const SendContractInput = z.object({
  templateId: z.string().uuid(),
  title: z.string().min(1).max(200),
  artistName: z.string().min(1).max(120),
  artistEmail: z.string().email(),
  bookingId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  // Extra merge vars on top of the system-provided set. Producers can
  // override or add — values are escaped before substitution.
  extraVars: z.record(z.string(), z.string().max(500)).optional(),
});

const SignInput = z.object({
  token: z.string().min(16).max(128),
  signatureDataUrl: z
    .string()
    .regex(/^data:image\/(png|svg\+xml);base64,/, "signature must be a data URL"),
  acceptedName: z.string().min(1).max(120),
});

// ─── Router ──────────────────────────────────────────────────────────
export const contractRouter = router({
  // ── Templates (producer-only) ────────────────────────────────────
  templates: router({
    list: producerProcedure.query(async ({ ctx }) => {
      return ctx.db
        .select()
        .from(contractTemplates)
        .where(eq(contractTemplates.producerId, ctx.producerId))
        .orderBy(desc(contractTemplates.updatedAt));
    }),

    create: producerProcedure.input(TemplateInput).mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(contractTemplates)
        .values({
          producerId: ctx.producerId,
          name: input.name,
          body: input.body,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return row;
    }),

    update: producerProcedure
      .input(TemplateInput.partial().extend({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...patch } = input;
        const [existing] = await ctx.db
          .select({ producerId: contractTemplates.producerId })
          .from(contractTemplates)
          .where(eq(contractTemplates.id, id))
          .limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        if (existing.producerId !== ctx.producerId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const [row] = await ctx.db
          .update(contractTemplates)
          .set({ ...stripUndefined(patch), updatedAt: new Date() })
          .where(eq(contractTemplates.id, id))
          .returning();
        if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return row;
      }),

    deactivate: producerProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select({ producerId: contractTemplates.producerId })
          .from(contractTemplates)
          .where(eq(contractTemplates.id, input.id))
          .limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        if (existing.producerId !== ctx.producerId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        await ctx.db
          .update(contractTemplates)
          .set({ active: false })
          .where(eq(contractTemplates.id, input.id));
        return { ok: true as const };
      }),
  }),

  // ── Contracts list + detail ──────────────────────────────────────
  list: producerProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(contracts)
      .where(eq(contracts.producerId, ctx.producerId))
      .orderBy(desc(contracts.createdAt));
  }),

  detail: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(contracts)
        .where(eq(contracts.id, input.id))
        .limit(1);
      if (!row || row.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const events = await ctx.db
        .select()
        .from(contractEvents)
        .where(eq(contractEvents.contractId, row.id))
        .orderBy(asc(contractEvents.occurredAt));
      return { contract: row, events };
    }),

  // Send a contract: resolve merge fields from template + booking +
  // extraVars, snapshot the resolved body, mint share token.
  send: producerProcedure.input(SendContractInput).mutation(async ({ ctx, input }) => {
    const [template] = await ctx.db
      .select()
      .from(contractTemplates)
      .where(eq(contractTemplates.id, input.templateId))
      .limit(1);
    if (!template || template.producerId !== ctx.producerId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "template not found" });
    }

    // Pull booking + producer info for merge fields. Booking is
    // optional so we gracefully handle standalone contracts.
    const vars: Record<string, string> = {
      artistName: input.artistName,
      artistEmail: input.artistEmail,
    };

    if (input.bookingId) {
      const [b] = await ctx.db
        .select()
        .from(bookings)
        .where(eq(bookings.id, input.bookingId))
        .limit(1);
      if (!b || b.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "booking not found" });
      }
      vars["sessionDate"] = b.startsAt.toLocaleString(undefined, {
        dateStyle: "long",
        timeStyle: "short",
      });
      vars["sessionDurationMin"] = String(b.durationMin);
      if (b.packageNameSnapshot) vars["packageName"] = b.packageNameSnapshot;
    }

    const [producer] = await ctx.db
      .select({ displayName: producers.displayName })
      .from(producers)
      .where(eq(producers.id, ctx.producerId))
      .limit(1);
    if (producer?.displayName) vars["producerName"] = producer.displayName;

    // Producer-provided overrides land on top.
    if (input.extraVars) {
      for (const [k, v] of Object.entries(input.extraVars)) vars[k] = v;
    }

    const bodyResolved = resolveMergeFields(template.body, vars);
    const token = mintToken();

    const [row] = await ctx.db
      .insert(contracts)
      .values({
        producerId: ctx.producerId,
        ...(input.bookingId ? { bookingId: input.bookingId } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        templateId: template.id,
        title: input.title,
        bodyResolved,
        artistName: input.artistName,
        artistEmail: input.artistEmail.toLowerCase(),
        shareTokenHash: token.hash,
        status: "sent",
      })
      .returning();
    if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    await logEvent(ctx.db, { contractId: row.id, kind: "sent" });
    return { contract: row, shareToken: token.raw };
  }),

  cancel: producerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db
        .select({ producerId: contracts.producerId, status: contracts.status })
        .from(contracts)
        .where(eq(contracts.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.producerId !== ctx.producerId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (existing.status === "signed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "cannot cancel a signed contract" });
      }
      await ctx.db
        .update(contracts)
        .set({ status: "cancelled" })
        .where(eq(contracts.id, input.id));
      await logEvent(ctx.db, { contractId: input.id, kind: "cancelled" });
      return { ok: true as const };
    }),

  // ── Artist public procedures (via token) ─────────────────────────

  // Fetch the contract for viewing. Marks 'viewed' on first query.
  publicByToken: publicProcedure
    .input(z.object({ token: z.string().min(16).max(128) }))
    .query(async ({ input }) => {
      const { db, ipHash, userAgent } = await publicCtx();
      const tokenHash = createHash("sha256").update(input.token).digest("hex");
      const [row] = await db
        .select()
        .from(contracts)
        .where(eq(contracts.shareTokenHash, tokenHash))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      // Producer display name for the sign page header.
      const [producer] = await db
        .select({ displayName: producers.displayName, slug: producers.slug })
        .from(producers)
        .where(eq(producers.id, row.producerId))
        .limit(1);

      // Log the view + advance status from sent → viewed (once).
      if (row.status === "sent") {
        await db.update(contracts).set({ status: "viewed" }).where(eq(contracts.id, row.id));
      }
      await logEvent(db, {
        contractId: row.id,
        kind: "viewed",
        ...(ipHash ? { ipHash } : {}),
        ...(userAgent ? { userAgent } : {}),
      });

      return {
        contract: {
          id: row.id,
          title: row.title,
          bodyResolved: row.bodyResolved,
          artistName: row.artistName,
          status: row.signedAt ? "signed" : (row.status === "sent" ? "viewed" : row.status),
          signedAt: row.signedAt,
          createdAt: row.createdAt,
        },
        producer: {
          displayName: producer?.displayName ?? "Producer",
          slug: producer?.slug ?? "",
        },
      };
    }),

  // Artist signs — attaches the signature image + audit info.
  publicSign: publicProcedure.input(SignInput).mutation(async ({ input }) => {
    const { db, ipHash, userAgent } = await publicCtx();
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    const [row] = await db
      .select()
      .from(contracts)
      .where(eq(contracts.shareTokenHash, tokenHash))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    if (row.status === "signed") {
      // Idempotent — re-signing is a no-op but still logs an event.
      return { alreadySigned: true };
    }
    if (row.status === "cancelled" || row.status === "expired") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `This contract is ${row.status}.`,
      });
    }

    // Typed name confirmation: require it matches the artistName on
    // record (case-insensitive). Guard against typos but allow small
    // differences — case, whitespace, trailing periods.
    const expected = row.artistName.trim().toLowerCase();
    const actual = input.acceptedName.trim().toLowerCase();
    if (expected !== actual) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Please type your name exactly as shown (${row.artistName}).`,
      });
    }

    const now = new Date();
    await db
      .update(contracts)
      .set({
        status: "signed",
        signatureDataUrl: input.signatureDataUrl,
        signedAt: now,
        ...(ipHash ? { signedIpHash: ipHash } : {}),
        ...(userAgent ? { signedUserAgent: userAgent } : {}),
      })
      .where(eq(contracts.id, row.id));
    await logEvent(db, {
      contractId: row.id,
      kind: "signed",
      ...(ipHash ? { ipHash } : {}),
      ...(userAgent ? { userAgent } : {}),
    });
    return { alreadySigned: false };
  }),
});
