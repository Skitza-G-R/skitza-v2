import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import {
  and,
  artistHistoricalAccessGrants,
  clientContacts,
  createDb,
  eq,
  isNull,
  producers,
} from "@skitza/db";
import { isAutoSlug } from "~/lib/slug";

// Role resolution — the single source of truth for "what kind of user
// is this person?" across every producer-only layout + server action.
//
// Added 2026-04-22 as the foundation of audit Task 16 (strict role
// isolation). Before this, each route group made its own ad-hoc
// decisions about who could enter, which created the hole Gili
// discovered during Task 15 QA (an artist could bypass (app)/layout
// by typing /onboarding directly).
//
// Split into pure classification/capability functions plus I/O wrappers:
//   - resolveUserRole: pure — takes already-fetched facts, returns
//     a discriminated-union Role. Unit-testable without any mocks.
//   - resolveUserAccess: preserves that launch role while exposing
//     independent producer/artist capabilities for dual-role accounts.
//   - fetchUserAccess/fetchUserRole: I/O wrappers around both facts.

export type ProducerRow = {
  id: string;
  displayName: string | null;
  slug: string;
  email: string;
};

export type UserRole =
  | { kind: "unauthenticated" }
  | { kind: "artist" }
  | { kind: "producer-incomplete"; producer: ProducerRow }
  | { kind: "producer-complete"; producer: ProducerRow }
  | { kind: "orphan" };

export type UserAccess = {
  role: UserRole;
  hasArtistAccess: boolean;
  hasProducerProfile: boolean;
  hasProducerAccess: boolean;
};

/**
 * Pure: given known facts about a user, classify their role.
 *
 * Rules, in priority order:
 *   1. No userId → "unauthenticated".
 *   2. Producer row exists → "producer-incomplete" or
 *      "producer-complete" depending on displayName + slug state.
 *      Producer identity ALWAYS wins over client_contacts when both
 *      exist (producer-who-is-also-an-artist edge — user confirmed
 *      this is the correct precedence).
 *   3. No producer row, has client_contacts → "artist".
 *   4. Neither → "orphan" (Clerk webhook race, sub-second window).
 */
export function resolveUserRole(input: {
  userId: string | null;
  producerRow: ProducerRow | null;
  hasClientContacts: boolean;
}): UserRole {
  const { userId, producerRow, hasClientContacts } = input;

  if (!userId) return { kind: "unauthenticated" };

  if (producerRow) {
    const incomplete =
      producerRow.displayName === null || isAutoSlug(producerRow.slug, producerRow.email);
    return incomplete
      ? { kind: "producer-incomplete", producer: producerRow }
      : { kind: "producer-complete", producer: producerRow };
  }

  if (hasClientContacts) return { kind: "artist" };
  return { kind: "orphan" };
}

export function resolveUserAccess(input: {
  userId: string | null;
  producerRow: ProducerRow | null;
  hasClientContacts: boolean;
}): UserAccess {
  const role = resolveUserRole(input);
  return {
    role,
    hasArtistAccess: input.userId !== null && input.hasClientContacts,
    hasProducerProfile: input.userId !== null && input.producerRow !== null,
    hasProducerAccess: role.kind === "producer-complete",
  };
}

/**
 * I/O: fetches both independent capability facts for this Clerk user.
 * Producer remains the default launch role, but an active artist
 * relationship must still permit an explicit visit to `/artist`.
 */
export async function fetchUserAccess(params: {
  dbUrl: string;
  userId: string | null;
}): Promise<UserAccess> {
  if (!params.userId) {
    return resolveUserAccess({
      userId: null,
      producerRow: null,
      hasClientContacts: false,
    });
  }

  const db = createDb(params.dbUrl);

  const [[producerRow], [contact], [pastStudioGrant]] = await Promise.all([
    db
      .select({
        id: producers.id,
        displayName: producers.displayName,
        slug: producers.slug,
        email: producers.email,
      })
      .from(producers)
      .where(eq(producers.clerkUserId, params.userId))
      .limit(1),
    db
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(and(eq(clientContacts.clerkUserId, params.userId), isNull(clientContacts.archivedAt)))
      .limit(1),
    db
      .select({ producerId: artistHistoricalAccessGrants.producerId })
      .from(artistHistoricalAccessGrants)
      .where(
        and(
          eq(artistHistoricalAccessGrants.artistClerkUserId, params.userId),
          eq(artistHistoricalAccessGrants.resourceType, "studio"),
          eq(
            artistHistoricalAccessGrants.resourceId,
            artistHistoricalAccessGrants.producerId,
          ),
        ),
      )
      .limit(1),
  ]);

  return resolveUserAccess({
    userId: params.userId,
    producerRow: producerRow ?? null,
    // A disconnected artist still owns Settings and exact Past-studio
    // records. The active studio query remains contact-only, so this grant
    // never becomes a switcher selection.
    hasClientContacts: contact !== undefined || pastStudioGrant !== undefined,
  });
}

export async function fetchUserRole(params: {
  dbUrl: string;
  userId: string | null;
}): Promise<UserRole> {
  return (await fetchUserAccess(params)).role;
}

export type ExpectedRole = "producer" | "artist";

/**
 * Pure: given a resolved role and the role a layout/action expects,
 * return the redirect path (or null = allow through).
 *
 * Replaces the earlier (producer)/decide-redirect.ts policy. Same
 * mapping for the producer side; adds the symmetric artist policy
 * required by CLAUDE.md ("Producer cannot reach /artist/*"):
 *
 *   producer:
 *     unauthenticated      → /sign-in
 *     artist               → /artist
 *     producer-incomplete  → /onboarding
 *     orphan               → /onboarding   (webhook race; wizard waits)
 *     producer-complete    → null (render)
 *
 *   artist:
 *     unauthenticated      → /sign-in?redirect_url=/artist
 *     producer-complete    → /dashboard    (CLAUDE.md role isolation)
 *     producer-incomplete  → /onboarding   (finish producer wizard)
 *     orphan               → /sign-in      (no DB identity → re-resolve)
 *     artist               → null (render)
 */
export function decideRoleRedirect(role: UserRole, expected: ExpectedRole): string | null {
  if (expected === "producer") {
    switch (role.kind) {
      case "unauthenticated":
        return "/sign-in";
      case "artist":
        return "/artist";
      case "producer-incomplete":
      case "orphan":
        return "/onboarding";
      case "producer-complete":
        return null;
    }
  }

  switch (role.kind) {
    case "unauthenticated":
      return "/sign-in?redirect_url=/artist";
    case "producer-complete":
      return "/dashboard";
    case "producer-incomplete":
      return "/onboarding";
    case "orphan":
      return "/sign-in";
    case "artist":
      return null;
  }
}

export function decideRoleAccessRedirect(
  access: UserAccess,
  expected: ExpectedRole,
): string | null {
  if (expected === "artist" && access.hasArtistAccess) return null;
  if (expected === "producer" && access.hasProducerAccess) return null;
  return decideRoleRedirect(access.role, expected);
}

/**
 * I/O: enforces the role boundary at the top of a protected layout
 * or server action. Calls Clerk + the DB to resolve the user's role,
 * then redirects on mismatch. Returns the resolved userId on allow so
 * callers don't need to re-call auth() before their own data loading.
 */
export async function requireRole(
  expected: ExpectedRole,
): Promise<{ userId: string; hasProducerProfile: boolean }> {
  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const access = await fetchUserAccess({ dbUrl, userId });
  const redirectTo = decideRoleAccessRedirect(access, expected);
  if (redirectTo) redirect(redirectTo);

  // Past the redirect → role is one of the allow-states, all of which
  // require a userId to have been resolved upstream.
  return {
    userId: userId as string,
    hasProducerProfile: access.hasProducerProfile,
  };
}
