import { TRPCError } from "@trpc/server";
import {
  eq,
  leads,
  magicLinks,
  magicLinkViews,
  portfolioTracks,
  producers,
} from "@skitza/db";
import { z } from "zod";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { stripUndefined } from "../strip-undefined";

// Accepts a subset of producer-editable fields. The schema's cascade is
// designed so any of these can change without orphaning related data.
// Slug uniqueness is enforced at the DB level; we catch + rethrow with
// a friendlier message via the leads/onboarding upsert pattern.
const BrandInput = z.object({
  // Hex colors stored as "#rrggbb" — the theme-resolver reads this into
  // CSS `--brand-primary` at request time (apps/web/src/lib/branding/
  // theme-resolver.ts). No other shape is honored.
  primary: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "primary must be a 6-digit hex color (#rrggbb)")
    .optional(),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "accent must be a 6-digit hex color (#rrggbb)")
    .optional(),
  // Logo URL — external for v1; R2 uploads land in weeks 6-8. Trim to
  // keep the jsonb payload small.
  logoUrl: z.string().url().max(512).optional(),
  // Font is a forward-looking slot; currently read by theme-resolver but
  // not yet exposed to the UI. Keep the input shape stable.
  font: z.string().max(64).optional(),
});

const UpdateInput = z.object({
  displayName: z.string().min(1).max(80).optional(),
  slug: z
    .string()
    .min(3)
    .max(48)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, numbers, and dashes")
    .optional(),
  defaultCurrency: z.enum(["USD", "EUR", "GBP", "ILS"]).optional(),
  timezone: z.string().min(1).max(64).optional(),
  brand: BrandInput.optional(),
});

export const producerRouter = router({
  // Current producer's profile — used by Settings to populate the form.
  // Same producerProcedure middleware so the SELECT is tenant-scoped
  // (UserId → Producer row) + the empty-row race is already handled by
  // the middleware throwing UNAUTHORIZED.
  me: producerProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select()
      .from(producers)
      .where(eq(producers.id, ctx.producerId))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    // Don't leak Stripe/Clerk IDs to the client — the UI only needs the
    // editable + display surface.
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      slug: row.slug,
      defaultCurrency: row.defaultCurrency,
      timezone: row.timezone,
      brand: row.brand ?? {},
      // Phase H.5 — surface Stripe Connect status flags so the
      // settings page can render "not connected / pending / connected"
      // without an extra round-trip. We don't surface the raw
      // accountId — the dashboard link mutation hands out a one-shot
      // signed URL when the producer asks for it.
      stripeConnected: Boolean(row.stripeAccountId),
      stripeChargesEnabled: row.stripeChargesEnabled,
    };
  }),

  // Full data export — everything Skitza stores tied to this producer.
  // GDPR-friendly: the producer can hit this at any time, get their
  // data as a self-contained JSON, and walk away. Explicitly excludes
  // the token hashes (they're one-way; no value in the export) and
  // internal IDs that only matter to Skitza's join graph.
  export: producerProcedure.query(async ({ ctx }) => {
    const [profile] = await ctx.db
      .select()
      .from(producers)
      .where(eq(producers.id, ctx.producerId))
      .limit(1);
    if (!profile) throw new TRPCError({ code: "NOT_FOUND" });

    const [tracks, leadRows, links, views] = await Promise.all([
      ctx.db
        .select()
        .from(portfolioTracks)
        .where(eq(portfolioTracks.producerId, ctx.producerId))
        .orderBy(portfolioTracks.position),
      ctx.db.select().from(leads).where(eq(leads.producerId, ctx.producerId)),
      ctx.db.select().from(magicLinks).where(eq(magicLinks.producerId, ctx.producerId)),
      // Views are joined through the links to keep the export
      // producer-scoped; we're not SELECTing every view row in the db.
      ctx.db
        .select({
          id: magicLinkViews.id,
          magicLinkId: magicLinkViews.magicLinkId,
          ip: magicLinkViews.ip,
          userAgent: magicLinkViews.userAgent,
          referer: magicLinkViews.referer,
          dwellMs: magicLinkViews.dwellMs,
          viewedAt: magicLinkViews.viewedAt,
        })
        .from(magicLinkViews)
        .innerJoin(magicLinks, eq(magicLinks.id, magicLinkViews.magicLinkId))
        .where(eq(magicLinks.producerId, ctx.producerId)),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      schema: "skitza-export-v1",
      profile: {
        id: profile.id,
        email: profile.email,
        displayName: profile.displayName,
        slug: profile.slug,
        defaultCurrency: profile.defaultCurrency,
        timezone: profile.timezone,
        brand: profile.brand ?? {},
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
      portfolioTracks: tracks,
      leads: leadRows,
      magicLinks: links.map((l) => ({
        id: l.id,
        leadId: l.leadId,
        target: l.target,
        expiresAt: l.expiresAt,
        revokedAt: l.revokedAt,
        createdAt: l.createdAt,
        // tokenHash deliberately omitted — it's one-way, no value to
        // the producer, and surfacing it would invite "decode this for
        // me" questions that would never succeed.
      })),
      magicLinkViews: views,
    };
  }),

  // Edit profile. brand merges over the existing JSONB (we fetch → spread
  // → set) so a UI only touching `primary` doesn't wipe `logoUrl`.
  update: producerProcedure.input(UpdateInput).mutation(async ({ ctx, input }) => {
    const { brand: brandPatch, ...fields } = input;
    // Merge brand JSONB with existing. Drizzle's jsonb helpers do NOT
    // support a built-in partial-update, so fetch + spread + write.
    let brand: typeof producers.$inferSelect.brand | undefined;
    if (brandPatch !== undefined) {
      const [existing] = await ctx.db
        .select({ brand: producers.brand })
        .from(producers)
        .where(eq(producers.id, ctx.producerId))
        .limit(1);
      brand = { ...(existing?.brand ?? {}), ...stripUndefined(brandPatch) };
    }

    try {
      const [updated] = await ctx.db
        .update(producers)
        .set(
          stripUndefined({
            ...fields,
            ...(brand === undefined ? {} : { brand }),
            updatedAt: new Date(),
          }),
        )
        .where(eq(producers.id, ctx.producerId))
        .returning();
      if (!updated) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return { ok: true as const };
    } catch (err) {
      // Slug UNIQUE collision at the DB surfaces as a generic postgres
      // error string; map to a clean BAD_REQUEST so the Server Action
      // can show a readable message.
      if (
        err instanceof Error &&
        /duplicate key value/.test(err.message) &&
        /slug/.test(err.message)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That slug is already taken — please choose another.",
        });
      }
      throw err;
    }
  }),
});
