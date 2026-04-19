import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  bookings,
  desc,
  eq,
  gte,
  inArray,
  invoices,
  isNull,
  leads,
  lte,
  magicLinks,
  magicLinkViews,
  portfolioTracks,
  producers,
  projectTracks,
  projects,
  trackComments,
  trackVersions,
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

// ─── Helpers (producer.today item shaping) ─────────────────────────
function truncate(s: string, max: number): string {
  const trimmed = s.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function formatInvoiceSubtitle(
  amountCents: number,
  currency: string,
  description: string | null,
): string {
  // cents → display units via Intl. Explicit 0-digit formatter keeps
  // whole-dollar amounts compact (“$250”), which reads better in a
  // list row than “$250.00”.
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amountCents / 100);
  return description ? `${amount} · ${description}` : amount;
}

// Shape returned by `producer.today`. One row per actionable thing the
// producer should look at in the current day. KPI counts ride
// alongside so the UI renders the strip + the inbox in a single call.
export type TodayKind = "session" | "comment" | "invoice" | "lead";
export interface TodayItem {
  id: string;
  kind: TodayKind;
  title: string;
  subtitle: string;
  occurredAt: Date;
  href: string;
  unread: boolean;
}

// Items list is capped at 50 in total. Big enough to avoid pagination
// for an active producer, small enough that the DOM stays honest.
const TODAY_ITEMS_MAX = 50;
// Per-source caps so one noisy source (60 fresh comments) can't
// crowd out the higher-priority kinds. The final urgency sort +
// slice(0, TODAY_ITEMS_MAX) then tightens the result.
const TODAY_PER_SOURCE_CAP = 40;

// Strict type ordering: sessions first (time-sensitive), then
// unread comments (artist is waiting), then unpaid invoices (money),
// then leads (maybe-future). Within each kind we sort by occurredAt
// (asc for upcoming sessions — soonest first; desc for everything
// else — most recent first). This matches the plan's documented
// "session > unread comment > invoice > lead" rule without inventing
// a composite score.
const KIND_PRIORITY: Record<TodayKind, number> = {
  session: 0,
  comment: 1,
  invoice: 2,
  lead: 3,
};

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

  // Producer's "Today" dashboard — one call returns the four KPI
  // counters AND the unified inbox of actionable items (upcoming
  // sessions, unread comments, unpaid invoices, leads). Pattern mirrors
  // `artist.home`: one Promise.all fan-out across four sources, each
  // WHERE-scoped to ctx.producerId, then shape + sort + cap.
  //
  // `savedViews` returns [] — persisting a user's saved filter requires
  // a new table, deferred to a later task.
  today: producerProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const horizon7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    // Calendar-month boundaries in UTC. Matches the booking.revenue
    // pattern so producers who flip between surfaces see consistent
    // numbers across month rollovers.
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const nextMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );

    // Active stages for the KPI counter — excludes terminal states so
    // "archived" and "cancelled" projects don't inflate the count.
    const ACTIVE_STAGES = [
      "lead",
      "booked",
      "contract_sent",
      "in_production",
      "final_review",
    ] as const;

    // Unpaid = anything NOT in {paid, refunded, void}. Matches the
    // artist-home outstanding-balance heuristic — draft + sent +
    // uncollectible all represent money the producer is still owed.
    const UNPAID_STATUSES = ["draft", "sent", "uncollectible"] as const;

    // Fan out across the 4 data sources in parallel. Each query is
    // independently producer-scoped (WHERE producer_id = ctx.producerId)
    // so a regression in any single sub-query can't leak other
    // producers' data. The producer profile lookup stays sequential —
    // we need defaultCurrency for the KPI payload before shaping.
    const [
      activeProjectRows,
      revenueRows,
      unpaidCountRows,
      upcomingRows,
      openCommentsCountRows,
      unpaidInvoiceRows,
      openCommentRows,
      leadRows,
    ] = await Promise.all([
      // (1) Active projects KPI — count by filtering stage in the
      // active set. We fetch ids only; the count is rows.length.
      ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.producerId, ctx.producerId),
            inArray(projects.stage, [...ACTIVE_STAGES]),
          ),
        ),

      // (2) Revenue-this-month KPI — sum of paid invoices whose
      // paidAt falls in the current calendar month. Fetch raw
      // amountCents/currency so currency-mismatched rows can be
      // filtered in JS (the producer's defaultCurrency is the anchor).
      ctx.db
        .select({
          amountCents: invoices.amountCents,
          currency: invoices.currency,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.producerId, ctx.producerId),
            eq(invoices.status, "paid"),
            gte(invoices.paidAt, monthStart),
            lte(invoices.paidAt, nextMonthStart),
          ),
        ),

      // (3) Unpaid-invoices count (feeds unresolvedItems KPI piece #1).
      ctx.db
        .select({ id: invoices.id })
        .from(invoices)
        .where(
          and(
            eq(invoices.producerId, ctx.producerId),
            inArray(invoices.status, [...UNPAID_STATUSES]),
          ),
        ),

      // (4) Upcoming sessions — confirmed bookings in [now, now+7d].
      // Also reused for the items list so we pull full fields.
      ctx.db
        .select({
          id: bookings.id,
          startsAt: bookings.startsAt,
          durationMin: bookings.durationMin,
          artistName: bookings.artistName,
          packageNameSnapshot: bookings.packageNameSnapshot,
        })
        .from(bookings)
        .where(
          and(
            eq(bookings.producerId, ctx.producerId),
            eq(bookings.status, "confirmed"),
            gte(bookings.startsAt, now),
            lte(bookings.startsAt, horizon7d),
          ),
        )
        .orderBy(asc(bookings.startsAt))
        .limit(TODAY_PER_SOURCE_CAP),

      // (5) Open-comments count (feeds unresolvedItems KPI piece #2).
      // Comments live on track_versions → project_tracks → projects;
      // we join through to scope on projects.producerId. Only
      // *artist-side* unresolved comments count — producer's own
      // comments are their own notes, not a to-do.
      ctx.db
        .select({ id: trackComments.id })
        .from(trackComments)
        .innerJoin(trackVersions, eq(trackVersions.id, trackComments.versionId))
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .where(
          and(
            eq(projects.producerId, ctx.producerId),
            isNull(trackComments.resolvedAt),
            eq(trackComments.fromProducer, false),
          ),
        ),

      // (6) Unpaid invoice rows (for items list).
      ctx.db
        .select({
          id: invoices.id,
          amountCents: invoices.amountCents,
          currency: invoices.currency,
          description: invoices.description,
          customerName: invoices.customerName,
          createdAt: invoices.createdAt,
          projectId: invoices.projectId,
          stripeCheckoutSessionId: invoices.stripeCheckoutSessionId,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.producerId, ctx.producerId),
            inArray(invoices.status, [...UNPAID_STATUSES]),
          ),
        )
        .orderBy(desc(invoices.createdAt))
        .limit(TODAY_PER_SOURCE_CAP),

      // (7) Open comment rows (for items list) — same join chain as (5)
      // but now with projection the UI needs.
      ctx.db
        .select({
          id: trackComments.id,
          body: trackComments.body,
          authorName: trackComments.authorName,
          createdAt: trackComments.createdAt,
          projectId: projects.id,
        })
        .from(trackComments)
        .innerJoin(trackVersions, eq(trackVersions.id, trackComments.versionId))
        .innerJoin(projectTracks, eq(projectTracks.id, trackVersions.trackId))
        .innerJoin(projects, eq(projects.id, projectTracks.projectId))
        .where(
          and(
            eq(projects.producerId, ctx.producerId),
            isNull(trackComments.resolvedAt),
            eq(trackComments.fromProducer, false),
          ),
        )
        .orderBy(desc(trackComments.createdAt))
        .limit(TODAY_PER_SOURCE_CAP),

      // (8) Lead rows for items list.
      ctx.db
        .select({
          id: leads.id,
          name: leads.name,
          email: leads.email,
          source: leads.source,
          createdAt: leads.createdAt,
        })
        .from(leads)
        .where(eq(leads.producerId, ctx.producerId))
        .orderBy(desc(leads.createdAt))
        .limit(TODAY_PER_SOURCE_CAP),
    ]);

    // Resolve default currency for KPI display. Fallback to USD keeps
    // the UI honest if the producer row ever has a NULL currency.
    const [profile] = await ctx.db
      .select({ defaultCurrency: producers.defaultCurrency })
      .from(producers)
      .where(eq(producers.id, ctx.producerId))
      .limit(1);
    const revenueCurrency = profile?.defaultCurrency ?? "USD";

    // Sum only the rows whose currency matches the default. Legacy
    // mixed-currency ledgers aren't common but we don't want to add
    // 500 EUR to 500 USD and call it 1000.
    const revenueMonthCents = revenueRows.reduce((acc, r) => {
      const amt = Number(r.amountCents ?? 0);
      const cur = (r.currency as string | null) ?? revenueCurrency;
      return cur === revenueCurrency ? acc + amt : acc;
    }, 0);

    const kpis = {
      activeProjects: activeProjectRows.length,
      revenueMonthCents,
      revenueCurrency,
      upcomingSessions7d: upcomingRows.length,
      unresolvedItems: unpaidCountRows.length + openCommentsCountRows.length,
    };

    // ── Compose the unified items list ──────────────────────────────
    // Each source projects into the common TodayItem shape. occurredAt
    // drives the within-kind sort: future (sessions) use startsAt;
    // past events use createdAt.
    const sessionItems: TodayItem[] = upcomingRows.map((b) => ({
      id: `session:${String(b.id)}`,
      kind: "session",
      title: String(b.artistName ?? "Artist"),
      subtitle: `${String(b.packageNameSnapshot ?? "Session")} · ${String(b.durationMin)} min`,
      occurredAt: b.startsAt as Date,
      href: `/dashboard/booking?id=${String(b.id)}`,
      unread: true,
    }));

    const commentItems: TodayItem[] = openCommentRows.map((c) => ({
      id: `comment:${String(c.id)}`,
      kind: "comment",
      title: String(c.authorName ?? "Artist"),
      subtitle: truncate(String(c.body ?? ""), 120),
      occurredAt: (c.createdAt as Date) ?? new Date(),
      href: c.projectId
        ? `/dashboard/projects/${String(c.projectId)}`
        : "/dashboard/projects",
      unread: true,
    }));

    const invoiceItems: TodayItem[] = unpaidInvoiceRows.map((inv) => ({
      id: `invoice:${String(inv.id)}`,
      kind: "invoice",
      title: String(inv.customerName ?? inv.description ?? "Invoice"),
      subtitle: formatInvoiceSubtitle(
        Number(inv.amountCents ?? 0),
        String(inv.currency ?? "USD"),
        (inv.description as string | null) ?? null,
      ),
      occurredAt: (inv.createdAt as Date) ?? new Date(),
      href: inv.projectId
        ? `/dashboard/projects/${String(inv.projectId)}`
        : "/dashboard/projects",
      unread: false,
    }));

    const leadItems: TodayItem[] = leadRows.map((l) => ({
      id: `lead:${String(l.id)}`,
      kind: "lead",
      title: String(l.name ?? l.email ?? "New lead"),
      subtitle: l.source ? `Source: ${String(l.source)}` : String(l.email ?? ""),
      occurredAt: (l.createdAt as Date) ?? new Date(),
      href: `/dashboard/projects?leadId=${String(l.id)}`,
      unread: true,
    }));

    const items = [...sessionItems, ...commentItems, ...invoiceItems, ...leadItems]
      .sort((a, b) => {
        // Primary: kind priority (session → comment → invoice → lead).
        const kp = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
        if (kp !== 0) return kp;
        // Within kind: sessions sort asc (soonest first), others desc.
        const at = a.occurredAt.getTime();
        const bt = b.occurredAt.getTime();
        return a.kind === "session" ? at - bt : bt - at;
      })
      .slice(0, TODAY_ITEMS_MAX);

    // Saved views aren't persisted yet — the UI treats [] as "no
    // saved views" and hides the chip rail. Shape stays so the client
    // doesn't have to special-case the missing field once views land.
    const savedViews: Array<{ id: string; label: string; filter: Record<string, string> }> = [];

    return { kpis, items, savedViews };
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
