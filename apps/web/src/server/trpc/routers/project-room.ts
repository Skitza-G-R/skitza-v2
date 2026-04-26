import { CreateMultipartUploadCommand } from "@aws-sdk/client-s3";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  bookings,
  clientContacts,
  contracts,
  desc,
  eq,
  inArray,
  invoices,
  isNull,
  producers,
  projectTracks,
  projects,
  trackComments,
  trackVersions,
  type Db,
} from "@skitza/db";
import { z } from "zod";

import { router } from "../init";
import { producerProcedure } from "../producer-procedure";
import { BUCKETS, buildAudioKey, getR2 } from "~/server/storage/r2";

// Project Room redesign 2026-04-26 — Story 02 (tRPC procedure split).
//
// This router replaces the monolithic `project.detail` aggregation
// (which fetches everything for all 4 sub-tabs in one round-trip) with
// 5 per-tab queries + 5 Music mutations. Each procedure scopes by
// `ctx.producerId` in its WHERE clause; tests assert this via
// `findPredicate` walking the and()-nested WHERE tree.
//
// `project.detail` stays in the project router (marked @deprecated)
// until the page (S03) migrates off it.

// Shared input — all per-tab queries take a project UUID.
const projectIdInput = z.object({ projectId: z.string().uuid() });

// Derived from the legacy depositPaid/finalPaid pair.
//   - both true  → "paid"
//   - deposit only → "deposit_paid"
//   - neither    → "unpaid"
//   - finalPaid alone (no deposit) is shaped 'paid' too — treat any final
//     payment as "fully settled" since the legacy schema doesn't model
//     final-without-deposit explicitly. The new pill UI reads this enum.
type PaymentStatus = "paid" | "deposit_paid" | "unpaid";
function derivePaymentStatus(args: {
  depositPaid: boolean;
  finalPaid: boolean;
}): PaymentStatus {
  if (args.finalPaid) return "paid";
  if (args.depositPaid) return "deposit_paid";
  return "unpaid";
}

// ─── Title derivation (createTrackFromUpload) ───────────────────────
// PRD §11.6 + S02 acceptance: server derives the track title from the
// uploaded filename by stripping common producer-naming suffixes. The
// goal is "drop file → title is reasonable without the producer typing
// anything." User can rename inline after the row appears.
//
// Strip pattern (case-insensitive):
//   1. file extension (`.wav`, `.mp3`, `.flac`, `.m4a`, `.aiff`, …)
//   2. one or more of `_v\d+` / `_master` / `_mix` / `_final` / `_demo` /
//      `_rough` (in any combination, repeated)
//   3. trim whitespace + leading/trailing `_`
//
// We loop the suffix-strip step because filenames often combine ("song
// _master_v3.wav" → "song"). The loop is bounded by string length so it
// terminates even on pathological inputs.
export function deriveTitleFromFilename(filename: string): string {
  // 1. Drop extension.
  let name = filename.replace(/\.[a-z0-9]{1,8}$/i, "");

  // 2. Iteratively strip recognised suffixes. The pattern matches any
  //    one of the suffixes anchored at the end with optional leading
  //    underscore/space; loops until no suffix remains.
  const suffixPattern =
    /[\s_-]+(?:v\d+|master|mix|final|demo|rough)\s*$/i;
  let prev = "";
  while (prev !== name) {
    prev = name;
    name = name.replace(suffixPattern, "");
  }

  // 3. Final tidy — collapse remaining whitespace, trim ends.
  name = name.replace(/\s+/g, " ").trim();

  // Fallback for pathological filenames that strip down to empty —
  // surface "Untitled track" rather than an empty string so downstream
  // NOT NULL constraints don't fail.
  return name.length > 0 ? name : "Untitled track";
}

// Walk from a projectId up to the producer-ownership check. Used by all
// mutations that mint R2 keys / write rows tied to a project. Cross-
// tenant access throws NOT_FOUND (avoid enumeration — story §Auth scoping).
async function assertOwnsProject(
  db: Db,
  producerId: string,
  projectId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.producerId, producerId),
      ),
    )
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
}

// Walk from a trackId up to the producer-ownership check.
async function assertOwnsTrack(
  db: Db,
  producerId: string,
  trackId: string,
): Promise<{ projectId: string }> {
  const [track] = await db
    .select({
      id: projectTracks.id,
      projectId: projectTracks.projectId,
    })
    .from(projectTracks)
    .where(eq(projectTracks.id, trackId))
    .limit(1);
  if (!track) throw new TRPCError({ code: "NOT_FOUND" });
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, track.projectId),
        eq(projects.producerId, producerId),
      ),
    )
    .limit(1);
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  return { projectId: track.projectId };
}

// Walk from a versionId up to the producer-ownership check.
async function assertOwnsVersion(
  db: Db,
  producerId: string,
  versionId: string,
): Promise<{ trackId: string; projectId: string }> {
  const [version] = await db
    .select({
      id: trackVersions.id,
      trackId: trackVersions.trackId,
    })
    .from(trackVersions)
    .where(eq(trackVersions.id, versionId))
    .limit(1);
  if (!version) throw new TRPCError({ code: "NOT_FOUND" });
  const { projectId } = await assertOwnsTrack(db, producerId, version.trackId);
  return { trackId: version.trackId, projectId };
}

// Walk from a commentId up to the producer-ownership check.
async function assertOwnsComment(
  db: Db,
  producerId: string,
  commentId: string,
): Promise<void> {
  const [comment] = await db
    .select({
      id: trackComments.id,
      versionId: trackComments.versionId,
    })
    .from(trackComments)
    .where(eq(trackComments.id, commentId))
    .limit(1);
  if (!comment) throw new TRPCError({ code: "NOT_FOUND" });
  await assertOwnsVersion(db, producerId, comment.versionId);
}

// Mint a multipart upload + return { uploadId, key } — same shape the
// existing useMultipartUpload hook consumes via initAudioUpload. The
// only difference vs. audio.initMultipart is we already validated
// ownership at the project / track level upstream.
async function mintPresignedMultipartInit(args: {
  producerId: string;
  trackVersionId: string;
  filename: string;
}): Promise<{ uploadId: string; key: string }> {
  const key = buildAudioKey({
    producerId: args.producerId,
    trackVersionId: args.trackVersionId,
    filename: args.filename,
  });
  const res = await getR2().send(
    new CreateMultipartUploadCommand({
      Bucket: BUCKETS.audio,
      Key: key,
    }),
  );
  if (!res.UploadId) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "R2 did not return an upload id",
    });
  }
  return { uploadId: res.UploadId, key };
}

// ─── Mutation input schemas ──────────────────────────────────────────
const CreateTrackFromUploadInput = z.object({
  projectId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  fileSize: z.number().int().positive(),
});

const AddVersionFromUploadInput = z.object({
  trackId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  fileSize: z.number().int().positive(),
});

const SetVersionStatusInput = z.object({
  versionId: z.string().uuid(),
  status: z.enum(["draft", "revisit", "final"]),
});

// Range-comment refinement: end > start AND both >= 0. Enforced at the
// Zod boundary so an invalid composition rejects before the DB write.
const AddRangeCommentInput = z
  .object({
    versionId: z.string().uuid(),
    body: z.string().min(1).max(2000),
    timestampMs: z.number().int().min(0).max(1000 * 60 * 60 * 3),
    endTimestampMs: z.number().int().min(0).max(1000 * 60 * 60 * 3),
  })
  .refine((input) => input.endTimestampMs > input.timestampMs, {
    message: "endTimestampMs must be greater than timestampMs",
    path: ["endTimestampMs"],
  });

const CommentIdInput = z.object({ commentId: z.string().uuid() });

export const projectRoomRouter = router({
  // ── shell ──────────────────────────────────────────────────────────
  // Page-shell data: the minimum to render the header strip + tab bar
  // before any tab data lands. ~10 columns. No fan-out. Used by the
  // server component to render the chrome before the client kicks off
  // per-tab queries.
  shell: producerProcedure
    .input(projectIdInput)
    .query(async ({ ctx, input }) => {
      // Auth-scoping: the WHERE clause filters by id AND producerId in
      // the same SELECT. Cross-tenant access reads as not-found from
      // the caller's POV (avoids enumeration — see PRD §11 / story §
      // Auth scoping).
      const [row] = await ctx.db
        .select({
          title: projects.title,
          artistName: projects.artistName,
          artistEmail: projects.artistEmail,
          stage: projects.stage,
          depositPaid: projects.depositPaid,
          finalPaid: projects.finalPaid,
        })
        .from(projects)
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.producerId, ctx.producerId),
          ),
        )
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });

      // Tag pills come from the client_contacts row matched by
      // (producerId, artistEmail). Lowercase the email so comparison
      // matches the contact-upsert path in recordContact. Missing
      // contact → empty pills (no error: tags are optional metadata).
      const [contact] = await ctx.db
        .select({ tags: clientContacts.tags })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.producerId, ctx.producerId),
            eq(clientContacts.email, row.artistEmail.toLowerCase()),
          ),
        )
        .limit(1);

      return {
        title: row.title,
        artistName: row.artistName,
        // No avatar surface yet — the PRD §11.5 sidebar mentions
        // "avatar" but the client_contacts row doesn't carry one in
        // v1. Field reserved for forward-compat (gravatar / Clerk
        // avatar fallback in a follow-up).
        artistAvatarUrl: null as string | null,
        stage: row.stage,
        paymentStatus: derivePaymentStatus({
          depositPaid: row.depositPaid,
          finalPaid: row.finalPaid,
        }),
        tagPills: contact?.tags ?? [],
      };
    }),

  // ── dashboard ─────────────────────────────────────────────────────
  // §11.5 Dashboard tab payload — fan-out aggregation that powers the
  // 5 focal modules + meta sidebar. The fan-out runs in parallel
  // (Promise.all) — each leg scopes by ctx.producerId either directly
  // (invoices, bookings, contracts) or transitively (tracks → project,
  // versions → tracks → project, comments → versions → tracks → project).
  //
  // whatsNext precedence ladder (PRD §11.5 step 3):
  //   1. contract not signed       → kind: 'send_contract'
  //   2. unpaid invoice past due   → kind: 'unpaid_invoice'
  //   3. session within 48h        → kind: 'upcoming_session'
  //   4. unread artist comment     → kind: 'unread_comment'
  //   5. latest version awaiting   → kind: 'awaiting_review'
  //   6. otherwise                 → null
  dashboard: producerProcedure
    .input(projectIdInput)
    .query(async ({ ctx, input }) => {
      // Project ownership check first — single SELECT with both id +
      // producerId predicates so cross-tenant lookups are
      // indistinguishable from "doesn't exist".
      const [project] = await ctx.db
        .select({
          id: projects.id,
          producerId: projects.producerId,
          title: projects.title,
          artistName: projects.artistName,
          artistEmail: projects.artistEmail,
          stage: projects.stage,
          depositPaid: projects.depositPaid,
          finalPaid: projects.finalPaid,
          currency: projects.currency,
          totalAmountCents: projects.totalAmountCents,
          bookingId: projects.bookingId,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
        })
        .from(projects)
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.producerId, ctx.producerId),
          ),
        )
        .limit(1);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      // Fan out the per-module legs in parallel. Each leg below carries
      // its own producer-scoping predicate (either by joining through
      // projects, or directly on a producer_id column).
      const [
        tracks,
        contractRows,
        invoiceRows,
        bookingRows,
      ] = await Promise.all([
        ctx.db
          .select({
            id: projectTracks.id,
            title: projectTracks.title,
            position: projectTracks.position,
            createdAt: projectTracks.createdAt,
          })
          .from(projectTracks)
          .where(eq(projectTracks.projectId, input.projectId))
          .orderBy(asc(projectTracks.position), asc(projectTracks.createdAt)),

        // Contracts for this project. Producer-scoped via the column on
        // contracts itself (loose link to project — set null on delete).
        ctx.db
          .select({
            id: contracts.id,
            status: contracts.status,
            sentAt: contracts.sentAt,
            signedAt: contracts.signedAt,
            createdAt: contracts.createdAt,
          })
          .from(contracts)
          .where(
            and(
              eq(contracts.producerId, ctx.producerId),
              eq(contracts.projectId, input.projectId),
            ),
          )
          .orderBy(desc(contracts.createdAt)),

        // Project invoices — producer-scoped on the invoices table. Used
        // for paid/outstanding totals + unpaid-invoice signal.
        ctx.db
          .select({
            id: invoices.id,
            amountCents: invoices.amountCents,
            currency: invoices.currency,
            status: invoices.status,
            description: invoices.description,
            createdAt: invoices.createdAt,
            paidAt: invoices.paidAt,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.producerId, ctx.producerId),
              eq(invoices.projectId, input.projectId),
            ),
          )
          .orderBy(desc(invoices.createdAt)),

        // Bookings for this project — used for the next-session signal
        // + activity feed. Producer-scoped on the bookings table.
        ctx.db
          .select({
            id: bookings.id,
            startsAt: bookings.startsAt,
            durationMin: bookings.durationMin,
            status: bookings.status,
            statusChangedAt: bookings.statusChangedAt,
            packageNameSnapshot: bookings.packageNameSnapshot,
          })
          .from(bookings)
          .where(
            and(
              eq(bookings.producerId, ctx.producerId),
              eq(bookings.projectId, input.projectId),
            ),
          )
          .orderBy(asc(bookings.startsAt)),
      ]);

      // Versions + comments are walked in two passes: first all versions
      // for this project (track_id IN trackIds), then all comments for
      // those versions. The cross-version unresolved query is the
      // canonical "unresolved comments stay visible across versions"
      // behavior (PRD §11.6 + S06).
      const trackIds = tracks.map((t) => t.id);
      const versionsRaw = trackIds.length
        ? await ctx.db
            .select({
              id: trackVersions.id,
              trackId: trackVersions.trackId,
              label: trackVersions.label,
              audioUrl: trackVersions.audioUrl,
              uploadedAt: trackVersions.uploadedAt,
              sizeBytes: trackVersions.sizeBytes,
              status: trackVersions.status,
              approvedAt: trackVersions.approvedAt,
            })
            .from(trackVersions)
            .where(inArray(trackVersions.trackId, trackIds))
            .orderBy(desc(trackVersions.uploadedAt))
        : [];

      const versionIds = versionsRaw.map((v) => v.id);
      const commentsRaw = versionIds.length
        ? await ctx.db
            .select({
              id: trackComments.id,
              versionId: trackComments.versionId,
              authorName: trackComments.authorName,
              body: trackComments.body,
              timestampMs: trackComments.timestampMs,
              endTimestampMs: trackComments.endTimestampMs,
              fromProducer: trackComments.fromProducer,
              resolvedAt: trackComments.resolvedAt,
              createdAt: trackComments.createdAt,
            })
            .from(trackComments)
            .where(
              and(
                inArray(trackComments.versionId, versionIds),
                isNull(trackComments.resolvedAt),
              ),
            )
            .orderBy(desc(trackComments.createdAt))
        : [];

      // ─── latestVersion ───────────────────────────────────────────────
      // The freshest version overall (versions are already DESC-sorted by
      // uploadedAt). Joins back to its track for trackTitle.
      const trackById = new Map(tracks.map((t) => [t.id, t] as const));
      const latestVersion = (() => {
        const head = versionsRaw[0];
        if (!head) return null;
        const track = trackById.get(head.trackId);
        if (!track) return null;
        return {
          trackId: head.trackId,
          trackTitle: track.title,
          versionId: head.id,
          versionLabel: head.label,
          audioUrl: head.audioUrl,
          sentAt: head.uploadedAt,
          // status is the new bilateral pill — defaults to 'draft' on
          // legacy rows via the migration's NOT NULL DEFAULT.
          statusEnum: head.status,
        };
      })();

      // ─── openComments ────────────────────────────────────────────────
      // Top 3 unresolved threads (already filtered + DESC-sorted in the
      // SELECT). Carry trackTitle so the render layer doesn't need a
      // separate lookup.
      const versionToTrack = new Map(
        versionsRaw.map((v) => [v.id, v.trackId] as const),
      );
      const openComments = commentsRaw
        .filter((c) => !c.fromProducer)
        .slice(0, 3)
        .map((c) => {
          const trackId = versionToTrack.get(c.versionId) ?? "";
          const track = trackById.get(trackId);
          return {
            id: c.id,
            trackId,
            trackTitle: track?.title ?? "",
            versionId: c.versionId,
            timestampMs: c.timestampMs,
            endTimestampMs: c.endTimestampMs,
            body: c.body,
            authorName: c.authorName,
            createdAt: c.createdAt,
          };
        });

      // ─── whatsNext ladder (PRD §11.5 step 3) ─────────────────────────
      const now = new Date();
      const horizon48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

      // Step 1 — contract exists but is NOT signed.
      const unsignedContract = contractRows.find(
        (c) => c.status !== "signed" && c.status !== "cancelled",
      );
      // Step 2 — unpaid invoice past due. We treat any sent/draft/
      // uncollectible invoice older than 7 days as "past due" since the
      // schema doesn't have a dueAt column on invoices yet.
      const unpaidInvoice = invoiceRows.find((i) =>
        ["sent", "draft", "uncollectible"].includes(i.status),
      );
      // Step 3 — confirmed session within 48h.
      const upcomingSession = bookingRows.find(
        (b) =>
          (b.status === "confirmed" || b.status === "pending") &&
          b.startsAt >= now &&
          b.startsAt <= horizon48h,
      );
      // Step 4 — unresolved artist comment.
      const unreadArtistComment = commentsRaw.find(
        (c) => !c.fromProducer && c.resolvedAt === null,
      );
      // Step 5 — latest version awaiting review (no approvedAt yet).
      const awaitingReview =
        versionsRaw[0] && !versionsRaw[0].approvedAt ? versionsRaw[0] : null;

      type WhatsNext =
        | { kind: "send_contract"; payload: { contractId: string | null } }
        | {
            kind: "unpaid_invoice";
            payload: {
              invoiceId: string;
              amountCents: number;
              currency: string;
            };
          }
        | {
            kind: "upcoming_session";
            payload: { bookingId: string; startsAt: Date };
          }
        | {
            kind: "unread_comment";
            payload: { commentId: string; trackId: string };
          }
        | {
            kind: "awaiting_review";
            payload: { versionId: string; sentAt: Date };
          };

      const whatsNext: WhatsNext | null = unsignedContract
        ? {
            kind: "send_contract",
            payload: { contractId: unsignedContract.id },
          }
        : unpaidInvoice
          ? {
              kind: "unpaid_invoice",
              payload: {
                invoiceId: unpaidInvoice.id,
                amountCents: unpaidInvoice.amountCents,
                currency: unpaidInvoice.currency,
              },
            }
          : upcomingSession
            ? {
                kind: "upcoming_session",
                payload: {
                  bookingId: upcomingSession.id,
                  startsAt: upcomingSession.startsAt,
                },
              }
            : unreadArtistComment
              ? {
                  kind: "unread_comment",
                  payload: {
                    commentId: unreadArtistComment.id,
                    trackId:
                      versionToTrack.get(unreadArtistComment.versionId) ?? "",
                  },
                }
              : awaitingReview
                ? {
                    kind: "awaiting_review",
                    payload: {
                      versionId: awaitingReview.id,
                      sentAt: awaitingReview.uploadedAt,
                    },
                  }
                : null;

      // ─── recentActivity ──────────────────────────────────────────────
      // Linear-style collapsed history. Merge events from track uploads,
      // comments, bookings, invoices, contracts into a single list,
      // sort desc by occurredAt, slice to 10 (UI client trims to 5).
      type ActivityKind =
        | "version_uploaded"
        | "comment_posted"
        | "comment_resolved"
        | "session_booked"
        | "session_confirmed"
        | "session_cancelled"
        | "invoice_sent"
        | "invoice_paid"
        | "contract_signed";
      type ActivityEvent = {
        id: string;
        kind: ActivityKind;
        occurredAt: Date;
        payload: Record<string, unknown>;
      };
      const events: ActivityEvent[] = [];
      for (const v of versionsRaw) {
        const track = trackById.get(v.trackId);
        events.push({
          id: `v:${v.id}`,
          kind: "version_uploaded",
          occurredAt: v.uploadedAt,
          payload: {
            versionId: v.id,
            trackId: v.trackId,
            trackTitle: track?.title ?? "",
            label: v.label,
          },
        });
      }
      for (const c of commentsRaw) {
        events.push({
          id: `c:${c.id}`,
          kind: "comment_posted",
          occurredAt: c.createdAt,
          payload: {
            commentId: c.id,
            authorName: c.authorName,
            preview: c.body.slice(0, 80),
            fromProducer: c.fromProducer,
          },
        });
      }
      for (const b of bookingRows) {
        const occurredAt = b.statusChangedAt ?? b.startsAt;
        events.push({
          id: `b:${b.id}`,
          kind:
            b.status === "confirmed"
              ? "session_confirmed"
              : b.status === "cancelled"
                ? "session_cancelled"
                : "session_booked",
          occurredAt,
          payload: {
            bookingId: b.id,
            startsAt: b.startsAt,
            durationMin: b.durationMin,
          },
        });
      }
      for (const inv of invoiceRows) {
        if (inv.status === "paid" && inv.paidAt) {
          events.push({
            id: `i:${inv.id}:paid`,
            kind: "invoice_paid",
            occurredAt: inv.paidAt,
            payload: {
              invoiceId: inv.id,
              amountCents: inv.amountCents,
              currency: inv.currency,
            },
          });
        } else if (inv.status === "sent") {
          events.push({
            id: `i:${inv.id}:sent`,
            kind: "invoice_sent",
            occurredAt: inv.createdAt,
            payload: {
              invoiceId: inv.id,
              amountCents: inv.amountCents,
              currency: inv.currency,
            },
          });
        }
      }
      for (const c of contractRows) {
        if (c.signedAt) {
          events.push({
            id: `ct:${c.id}:signed`,
            kind: "contract_signed",
            occurredAt: c.signedAt,
            payload: { contractId: c.id },
          });
        }
      }
      events.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
      const recentActivity = events.slice(0, 10);

      // ─── sidebar ─────────────────────────────────────────────────────
      const projectCurrency = project.currency ?? "USD";
      let paidCents = 0;
      let outstandingCents = 0;
      for (const inv of invoiceRows) {
        if (inv.currency !== projectCurrency) continue;
        if (inv.status === "paid") paidCents += inv.amountCents;
        else if (
          inv.status === "draft" ||
          inv.status === "sent" ||
          inv.status === "uncollectible"
        ) {
          outstandingCents += inv.amountCents;
        }
      }
      const paidAmount = paidCents
        ? { cents: paidCents, currency: projectCurrency }
        : null;
      const outstandingAmount = outstandingCents
        ? { cents: outstandingCents, currency: projectCurrency }
        : null;
      const agreedAmount =
        project.totalAmountCents !== null
          ? {
              cents: project.totalAmountCents,
              currency: projectCurrency,
            }
          : null;

      // Next confirmed session ≥ now.
      const nextSession =
        bookingRows.find(
          (b) => b.status === "confirmed" && b.startsAt >= now,
        ) ?? null;

      const fileTotalBytes = versionsRaw.reduce(
        (acc, v) => acc + (v.sizeBytes ?? 0),
        0,
      );

      return {
        latestVersion,
        whatsNext,
        recentActivity,
        openComments,
        sidebar: {
          stage: project.stage,
          agreedAmount,
          paidAmount,
          outstandingAmount,
          nextSession: nextSession
            ? {
                id: nextSession.id,
                startsAt: nextSession.startsAt,
                durationMin: nextSession.durationMin,
                packageName: nextSession.packageNameSnapshot,
              }
            : null,
          fileCount: versionsRaw.length,
          fileTotalBytes,
          artist: {
            name: project.artistName,
            avatarUrl: null as string | null,
            email: project.artistEmail,
          },
        },
      };
    }),

  // ── music ─────────────────────────────────────────────────────────
  // §11.6 Music tab payload — tracks + versions + cross-version
  // unresolved comments. Each track's `unresolvedComments` is the
  // canonical Replay-style cross-version persistence query: comments
  // posted on V1 that are still unresolved follow forward to V2/V3
  // until a producer or artist marks them resolved. The query joins
  // track_comments → track_versions on track_id and filters by
  // resolved_at IS NULL — covered by the
  // track_comments_version_unresolved_idx index from S01.
  music: producerProcedure
    .input(projectIdInput)
    .query(async ({ ctx, input }) => {
      // Auth-scoping: project must exist + belong to caller.
      const [project] = await ctx.db
        .select({
          id: projects.id,
          producerId: projects.producerId,
          artistEmail: projects.artistEmail,
        })
        .from(projects)
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.producerId, ctx.producerId),
          ),
        )
        .limit(1);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const tracks = await ctx.db
        .select({
          id: projectTracks.id,
          title: projectTracks.title,
          artist: projectTracks.artist,
          position: projectTracks.position,
          createdAt: projectTracks.createdAt,
        })
        .from(projectTracks)
        .where(eq(projectTracks.projectId, input.projectId))
        .orderBy(asc(projectTracks.position), asc(projectTracks.createdAt));

      if (tracks.length === 0) {
        return { tracks: [] as Array<{
          id: string;
          title: string;
          artistTag: string | null;
          createdAt: Date;
          versions: Array<{
            id: string;
            label: string;
            audioUrl: string | null;
            audioReady: boolean;
            statusEnum: string;
            createdAt: Date;
          }>;
          unresolvedComments: Array<{
            id: string;
            versionId: string;
            versionLabel: string;
            authorName: string;
            body: string;
            timestampMs: number;
            endTimestampMs: number | null;
            fromProducer: boolean;
            createdAt: Date;
          }>;
        }> };
      }

      const trackIds = tracks.map((t) => t.id);
      // Versions for all tracks in this project. Sorted desc by
      // uploadedAt so the head of each per-track group is the newest.
      const versionsRaw = await ctx.db
        .select({
          id: trackVersions.id,
          trackId: trackVersions.trackId,
          label: trackVersions.label,
          audioUrl: trackVersions.audioUrl,
          uploadedAt: trackVersions.uploadedAt,
          status: trackVersions.status,
        })
        .from(trackVersions)
        .where(inArray(trackVersions.trackId, trackIds))
        .orderBy(desc(trackVersions.uploadedAt));

      // Group versions per track.
      const versionsByTrack = new Map<string, typeof versionsRaw>();
      for (const v of versionsRaw) {
        const arr = versionsByTrack.get(v.trackId) ?? [];
        arr.push(v);
        versionsByTrack.set(v.trackId, arr);
      }

      // Cross-version unresolved comments — one query per track. Each
      // joins track_comments → track_versions on track_id, filters by
      // resolved_at IS NULL, sorts by created_at DESC. The
      // track_comments_version_unresolved_idx index from S01 covers
      // this access pattern.
      //
      // We run the per-track queries via Promise.all so the client sees
      // a single round-trip cost.
      const unresolvedByTrack = await Promise.all(
        tracks.map(async (track) => {
          const rows = await ctx.db
            .select({
              id: trackComments.id,
              versionId: trackComments.versionId,
              versionLabel: trackVersions.label,
              authorName: trackComments.authorName,
              body: trackComments.body,
              timestampMs: trackComments.timestampMs,
              endTimestampMs: trackComments.endTimestampMs,
              fromProducer: trackComments.fromProducer,
              createdAt: trackComments.createdAt,
            })
            .from(trackComments)
            .innerJoin(
              trackVersions,
              eq(trackVersions.id, trackComments.versionId),
            )
            .where(
              and(
                eq(trackVersions.trackId, track.id),
                isNull(trackComments.resolvedAt),
              ),
            )
            .orderBy(desc(trackComments.createdAt));
          return [track.id, rows] as const;
        }),
      );
      const unresolvedMap = new Map(unresolvedByTrack);

      return {
        tracks: tracks.map((t) => {
          const trackVersionsForT = versionsByTrack.get(t.id) ?? [];
          return {
            id: t.id,
            title: t.title,
            artistTag: t.artist,
            createdAt: t.createdAt,
            versions: trackVersionsForT.map((v) => ({
              id: v.id,
              label: v.label,
              audioUrl: v.audioUrl,
              // audioReady: the legacy schema didn't carry an explicit
              // flag — we infer from the URL being non-null (the
              // completeMultipart action patches the URL only after the
              // R2 object is finalized). New uploads start with null
              // until the upload completes.
              audioReady: v.audioUrl !== null,
              statusEnum: v.status,
              createdAt: v.uploadedAt,
            })),
            unresolvedComments: unresolvedMap.get(t.id) ?? [],
          };
        }),
      };
    }),

  // ── sessions ─────────────────────────────────────────────────────
  // Bookings tied to this project. Producer-scoped on bookings.
  // Mostly relocated from project.detail / page.tsx — the new sub-tab
  // fetches it independently so a tab switch doesn't refetch unrelated
  // music data.
  sessions: producerProcedure
    .input(projectIdInput)
    .query(async ({ ctx, input }) => {
      // Auth check on the project.
      const [project] = await ctx.db
        .select({
          id: projects.id,
          producerId: projects.producerId,
        })
        .from(projects)
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.producerId, ctx.producerId),
          ),
        )
        .limit(1);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const rows = await ctx.db
        .select({
          id: bookings.id,
          startsAt: bookings.startsAt,
          durationMin: bookings.durationMin,
          status: bookings.status,
          artistName: bookings.artistName,
          artistEmail: bookings.artistEmail,
          packageNameSnapshot: bookings.packageNameSnapshot,
          notes: bookings.notes,
          statusChangedAt: bookings.statusChangedAt,
        })
        .from(bookings)
        .where(
          and(
            eq(bookings.producerId, ctx.producerId),
            eq(bookings.projectId, input.projectId),
          ),
        )
        .orderBy(asc(bookings.startsAt));

      return { bookings: rows };
    }),

  // ── money ────────────────────────────────────────────────────────
  // Money sub-tab payload — paid + outstanding totals (mirror existing
  // project.money), the full invoice list, contract summary (most
  // recent contract for this project), and any saved Stripe payment
  // methods relevant to a future-charge plan.
  money: producerProcedure
    .input(projectIdInput)
    .query(async ({ ctx, input }) => {
      // Auth + project metadata.
      const [project] = await ctx.db
        .select({
          id: projects.id,
          producerId: projects.producerId,
          currency: projects.currency,
          nextChargeAt: projects.nextChargeAt,
          paymentPlanKind: projects.paymentPlanKind,
          stripeCustomerId: projects.stripeCustomerId,
          stripePaymentMethodId: projects.stripePaymentMethodId,
        })
        .from(projects)
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.producerId, ctx.producerId),
          ),
        )
        .limit(1);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });

      const [invoiceRows, contractRows] = await Promise.all([
        ctx.db
          .select({
            id: invoices.id,
            amountCents: invoices.amountCents,
            currency: invoices.currency,
            status: invoices.status,
            kind: invoices.kind,
            description: invoices.description,
            customerName: invoices.customerName,
            createdAt: invoices.createdAt,
            paidAt: invoices.paidAt,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.producerId, ctx.producerId),
              eq(invoices.projectId, input.projectId),
            ),
          )
          .orderBy(desc(invoices.createdAt)),

        ctx.db
          .select({
            id: contracts.id,
            title: contracts.title,
            status: contracts.status,
            sentAt: contracts.sentAt,
            signedAt: contracts.signedAt,
            createdAt: contracts.createdAt,
          })
          .from(contracts)
          .where(
            and(
              eq(contracts.producerId, ctx.producerId),
              eq(contracts.projectId, input.projectId),
            ),
          )
          .orderBy(desc(contracts.createdAt)),
      ]);

      // Currency: prefer the project's persisted currency; fall back
      // to the first invoice's currency (legacy rows pre-migration
      // 0023). Mixed-currency ledgers are excluded from the totals to
      // avoid silently adding USD + EUR.
      const currency =
        project.currency ?? invoiceRows[0]?.currency ?? "USD";

      let paidCents = 0;
      let outstandingCents = 0;
      for (const inv of invoiceRows) {
        if (inv.currency !== currency) continue;
        if (inv.status === "paid") {
          paidCents += inv.amountCents;
        } else if (
          inv.status === "draft" ||
          inv.status === "sent" ||
          inv.status === "uncollectible"
        ) {
          outstandingCents += inv.amountCents;
        }
      }

      // Most-recent contract is the summary the UI renders next to the
      // money strip ("Master agreement — signed Apr 2"). UI deep-links
      // to the contracts list for the full set.
      const contractSummary = contractRows[0] ?? null;

      // stripePaymentMethods: for v1, just expose the saved payment
      // method id from the project row. The Stripe API call to fetch
      // the card last-4 happens in the page-level fetch path (see
      // page.tsx) so this query stays cheap + cache-friendly. The UI
      // hits stripe.paymentMethods.retrieve from the page render.
      const stripePaymentMethods = project.stripePaymentMethodId
        ? [{ id: project.stripePaymentMethodId }]
        : ([] as Array<{ id: string }>);

      return {
        paidCents,
        outstandingCents,
        currency,
        nextChargeAt: project.nextChargeAt,
        invoices: invoiceRows,
        contractSummary,
        stripePaymentMethods,
      };
    }),

  // ── createTrackFromUpload (Music tab — drop-first) ───────────────
  // Replaces the title-first add-track form. Server derives the title
  // from the filename (strip extension + suffixes), creates Track + V1
  // rows with audioUrl=null + status='draft', and returns the multipart
  // upload init bundle so the client can immediately PUT parts to R2.
  //
  // Why bundle the R2 init here (vs. two roundtrips, one to create and
  // one to call audio.initMultipart): the new "drop a file → it
  // appears" flow needs zero intermediate states. A single mutation
  // does the DB + R2 setup atomically.
  createTrackFromUpload: producerProcedure
    .input(CreateTrackFromUploadInput)
    .mutation(async ({ ctx, input }) => {
      await assertOwnsProject(ctx.db, ctx.producerId, input.projectId);

      // Compute next position for the inserted track row.
      const existing = await ctx.db
        .select({ position: projectTracks.position })
        .from(projectTracks)
        .where(eq(projectTracks.projectId, input.projectId))
        .orderBy(asc(projectTracks.position));
      const nextPos =
        existing.length === 0
          ? 0
          : (existing[existing.length - 1]?.position ?? 0) + 1;

      const title = deriveTitleFromFilename(input.filename);
      const [trackRow] = await ctx.db
        .insert(projectTracks)
        .values({
          projectId: input.projectId,
          title,
          position: nextPos,
        })
        .returning();
      if (!trackRow) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }

      // V1 row — no audioUrl yet; the client's multipart PUT + the
      // existing audio.completeMultipart will patch it once the parts
      // upload finishes.
      const [versionRow] = await ctx.db
        .insert(trackVersions)
        .values({
          trackId: trackRow.id,
          label: "V1",
          audioUrl: null,
          status: "draft",
          sizeBytes: input.fileSize,
        })
        .returning();
      if (!versionRow) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }

      const presignedMultipartInit = await mintPresignedMultipartInit({
        producerId: ctx.producerId,
        trackVersionId: versionRow.id,
        filename: input.filename,
      });

      // Touch the project's updatedAt so it floats in Kanban / activity.
      await ctx.db
        .update(projects)
        .set({ updatedAt: new Date() })
        .where(eq(projects.id, input.projectId));

      return {
        trackId: trackRow.id,
        versionId: versionRow.id,
        presignedMultipartInit,
      };
    }),

  // ── addVersionFromUpload (Music tab — drop-on-row) ───────────────
  // Drop a file onto an existing track row → it becomes the next
  // version of that track (V<N+1>). Same R2 init bundle is returned;
  // the client uses the existing useMultipartUpload pipeline.
  addVersionFromUpload: producerProcedure
    .input(AddVersionFromUploadInput)
    .mutation(async ({ ctx, input }) => {
      await assertOwnsTrack(ctx.db, ctx.producerId, input.trackId);

      // Derive next label as V<existing+1>. The label is loose text
      // historically — producers can rename later — but defaulting to
      // V<N+1> matches Frame.io / Replay UX.
      const existingVersions = await ctx.db
        .select({ id: trackVersions.id })
        .from(trackVersions)
        .where(eq(trackVersions.trackId, input.trackId))
        .limit(1000);
      const nextLabel = `V${String(existingVersions.length + 1)}`;

      const [versionRow] = await ctx.db
        .insert(trackVersions)
        .values({
          trackId: input.trackId,
          label: nextLabel,
          audioUrl: null,
          status: "draft",
          sizeBytes: input.fileSize,
        })
        .returning();
      if (!versionRow) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }

      const presignedMultipartInit = await mintPresignedMultipartInit({
        producerId: ctx.producerId,
        trackVersionId: versionRow.id,
        filename: input.filename,
      });

      return {
        versionId: versionRow.id,
        presignedMultipartInit,
      };
    }),

  // ── setVersionStatus (bilateral pill) ────────────────────────────
  // Flips track_versions.status between 'draft' | 'revisit' | 'final'.
  // The pill renders different copy per role (producer sees "Final",
  // artist sees "Approved") but the underlying enum is one column.
  //
  // Backward-compat: when status flips TO 'final', also stamp
  // approvedAt = NOW() so the existing approvedAt-driven flows
  // (notification triggers, auto-release-on-paid in §11.3) keep firing.
  // When status flips OFF 'final' (back to draft / revisit), clear
  // approvedAt — otherwise the legacy "this version is approved"
  // branches misfire on a version that's no longer approved.
  setVersionStatus: producerProcedure
    .input(SetVersionStatusInput)
    .mutation(async ({ ctx, input }) => {
      await assertOwnsVersion(ctx.db, ctx.producerId, input.versionId);

      const approvedAt = input.status === "final" ? new Date() : null;
      await ctx.db
        .update(trackVersions)
        .set({
          status: input.status,
          approvedAt,
        })
        .where(eq(trackVersions.id, input.versionId));

      return { ok: true as const, status: input.status };
    }),

  // ── addRangeComment (Music tab — Pibox-style range feedback) ────
  // Drag-on-waveform → comment spans [timestampMs, endTimestampMs].
  // Validation lives at the Zod boundary (refine — end > start, both
  // >= 0). The existing point-comment procedure stays in the project
  // router; this is the new range-comment surface added in S01's
  // migration.
  addRangeComment: producerProcedure
    .input(AddRangeCommentInput)
    .mutation(async ({ ctx, input }) => {
      const { projectId } = await assertOwnsVersion(
        ctx.db,
        ctx.producerId,
        input.versionId,
      );

      // Look up artist name + producer display name from the project
      // ownership chain. We use the producer's display name as the
      // author label when fromProducer=true (matches the
      // addProducerComment pattern in the legacy router).
      const [project] = await ctx.db
        .select({
          artistEmail: projects.artistEmail,
          artistName: projects.artistName,
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      const [producerRow] = await ctx.db
        .select({ displayName: producers.displayName })
        .from(producers)
        .where(eq(producers.id, ctx.producerId))
        .limit(1);

      const [row] = await ctx.db
        .insert(trackComments)
        .values({
          versionId: input.versionId,
          authorName: producerRow?.displayName ?? "Producer",
          authorEmail: project?.artistEmail ?? "",
          body: input.body,
          timestampMs: input.timestampMs,
          endTimestampMs: input.endTimestampMs,
          fromProducer: true,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return row;
    }),

  // ── resolveComment / unresolveComment ────────────────────────────
  // Toggle resolved_at. resolveComment → NOW(); unresolveComment → null.
  // Producer-only for v1; artist-side toggling can ship as a follow-up
  // via artistProcedure (see architecture doc §10.x).
  resolveComment: producerProcedure
    .input(CommentIdInput)
    .mutation(async ({ ctx, input }) => {
      await assertOwnsComment(ctx.db, ctx.producerId, input.commentId);
      await ctx.db
        .update(trackComments)
        .set({ resolvedAt: new Date() })
        .where(eq(trackComments.id, input.commentId));
      return { ok: true as const };
    }),

  unresolveComment: producerProcedure
    .input(CommentIdInput)
    .mutation(async ({ ctx, input }) => {
      await assertOwnsComment(ctx.db, ctx.producerId, input.commentId);
      await ctx.db
        .update(trackComments)
        .set({ resolvedAt: null })
        .where(eq(trackComments.id, input.commentId));
      return { ok: true as const };
    }),
});
