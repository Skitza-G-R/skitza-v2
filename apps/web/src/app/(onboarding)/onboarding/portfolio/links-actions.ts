"use server";

import { auth } from "@clerk/nextjs/server";
import { and, createDb, eq, producerExternalLinks } from "@skitza/db";
import { z } from "zod";

import { fetchUserRole } from "~/server/auth/role";

// Story 06 — Onboarding portfolio external-links bulk-save action.
//
// Contract (story spec):
//   "use server";
//   async function saveExternalLinks(input: {
//     links: { platform: "spotify" | "youtube" | "instagram_reels"; url: string }[];
//   }): Promise<void>;
//
// Per link:
//   • url === ""      → DELETE FROM producer_external_links
//                       WHERE producer_id = ctx.producerId AND platform = link.platform
//   • url non-empty   → INSERT … ON CONFLICT (producer_id, platform)
//                       DO UPDATE SET url = EXCLUDED.url
//
// The unique constraint backing ON CONFLICT lives at
//   producer_external_links_producer_platform_unique (producer_id, platform)
// — added in migration 0034 alongside this story.
//
// Auth scoping (CLAUDE.md non-negotiable): producerId is ALWAYS pulled
// from the Clerk session via fetchUserRole — NEVER trusted from input.
// Every WHERE / values clause includes the producerId so a multi-tenant
// data leak is structurally impossible.
//
// Why a server action vs a tRPC mutation: the existing
// producer-external-links router exposes single-row CRUD (add /
// remove / reorder) keyed by row id. The wizard's UX is bulk: 3
// platform inputs handed off as one payload. We could call the
// router three times from the client, but (a) it'd require dispatching
// a "what's the row id for this platform?" lookup first, and (b) the
// upsert+delete branch is bespoke to this UX. A thin server action
// keeps the bulk concern inside the onboarding folder and the existing
// router unchanged. Future Setup → Portfolio surface can reuse the
// same action — no duplication.

// ─── Input shape ────────────────────────────────────────────────────

const SUPPORTED_PLATFORMS = [
  "spotify",
  "youtube",
  "instagram_reels",
] as const;

const platformSchema = z.enum(SUPPORTED_PLATFORMS);

// URL: empty string is valid (DELETE branch). Non-empty must respect
// the 500-char DB cap. Lenient http(s) check happens client-side via
// linkRowError; here we only enforce length so a malicious caller
// can't smuggle a huge string through.
const linkSchema = z.object({
  platform: platformSchema,
  url: z.string().max(500),
});

const Input = z.object({
  links: z.array(linkSchema),
});

// ─── Action ─────────────────────────────────────────────────────────

export async function saveExternalLinks(input: {
  links: Array<{
    platform: "spotify" | "youtube" | "instagram_reels";
    url: string;
  }>;
}): Promise<void> {
  // 1. Auth — Clerk session.
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  // 2. DB URL — same defense pattern as completeStudio.
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  // 3. Role-resolve. Same defense-in-depth as completeStudio: the
  // (onboarding)/layout gate already redirects artists, but a raw HTTP
  // POST bypasses the layout. Without this guard a signed-in artist
  // could write to producer_external_links via input.producerId-less
  // smuggling. The role check + producer lookup closes the hole.
  const role = await fetchUserRole({ dbUrl, userId });
  if (role.kind === "artist") {
    throw new Error("forbidden: artists cannot edit producer portfolio links");
  }
  if (role.kind === "orphan" || role.kind === "unauthenticated") {
    // Orphan = Clerk session exists but no producers row yet (webhook
    // race in completeStudio's sub-second window). They can't have
    // links to save before they have a producer row, so reject early.
    throw new Error("forbidden: producer row not provisioned");
  }

  const producerId = role.producer.id;

  // 4. Validate input shape via zod.
  const parsed = Input.parse(input);

  // Empty input is a valid no-op (the producer hit Continue with no
  // changes). Skip even creating the db client.
  if (parsed.links.length === 0) return;

  const db = createDb(dbUrl);

  // 5. Per-link branch:
  //    • empty url → DELETE row for (producer, platform)
  //    • non-empty url → INSERT … ON CONFLICT DO UPDATE
  // Ordered by the input array so a debugger-stepped session reads
  // the actions in the same order the producer specified them.
  // Promise.all is safe: each query targets a different (producer,
  // platform) row, so they don't deadlock or stomp each other.
  await Promise.all(
    parsed.links.map((link) => {
      const trimmed = link.url.trim();
      if (trimmed === "") {
        // DELETE branch. Scoped by (producer_id, platform); a non-
        // existent row is a no-op (zero-row outcome is fine here —
        // the action's contract is "make state match input", not
        // "every link must have existed before").
        return db
          .delete(producerExternalLinks)
          .where(
            and(
              eq(producerExternalLinks.producerId, producerId),
              eq(producerExternalLinks.platform, link.platform),
            ),
          );
      }
      // UPSERT branch. ON CONFLICT targets the unique constraint
      // (producer_id, platform) added in migration 0034. The SET
      // clause overwrites url; createdAt + position stay as-is on
      // existing rows so the producer's reorder choices persist.
      return db
        .insert(producerExternalLinks)
        .values({
          producerId,
          platform: link.platform,
          url: trimmed,
          // Default position 0 only matters on first insert; existing
          // rows keep their position via the ON CONFLICT DO UPDATE
          // not setting the column.
          position: 0,
        })
        .onConflictDoUpdate({
          target: [
            producerExternalLinks.producerId,
            producerExternalLinks.platform,
          ],
          set: {
            url: trimmed,
          },
        });
    }),
  );
}
