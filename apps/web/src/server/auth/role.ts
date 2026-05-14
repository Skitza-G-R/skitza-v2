import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { createDb, producers, clientContacts, eq, and, isNull } from "@skitza/db";
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
// Split into two functions:
//   - resolveUserRole: pure — takes already-fetched facts, returns
//     a discriminated-union Role. Unit-testable without any mocks.
//   - fetchUserRole: I/O wrapper — does the Drizzle lookups against
//     producers + client_contacts, then calls resolveUserRole.

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
      producerRow.displayName === null ||
      isAutoSlug(producerRow.slug, producerRow.email);
    return incomplete
      ? { kind: "producer-incomplete", producer: producerRow }
      : { kind: "producer-complete", producer: producerRow };
  }

  if (hasClientContacts) return { kind: "artist" };
  return { kind: "orphan" };
}

/**
 * I/O: fetches the producer row + checks for any client_contacts row
 * for this Clerk user, then classifies. Called from layouts + server
 * actions that need to enforce role boundaries.
 *
 * Two queries worst case: one always hits producers (single index
 * lookup on clerkUserId, unique). The second only fires when no
 * producer row exists — the common path (established producer
 * hitting /dashboard) stays at one query.
 */
export async function fetchUserRole(params: {
  dbUrl: string;
  userId: string | null;
}): Promise<UserRole> {
  if (!params.userId) return { kind: "unauthenticated" };

  const db = createDb(params.dbUrl);

  const [producerRow] = await db
    .select({
      id: producers.id,
      displayName: producers.displayName,
      slug: producers.slug,
      email: producers.email,
    })
    .from(producers)
    .where(eq(producers.clerkUserId, params.userId))
    .limit(1);

  let hasClientContacts = false;
  if (!producerRow) {
    const [contact] = await db
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.clerkUserId, params.userId),
          isNull(clientContacts.archivedAt),
        ),
      )
      .limit(1);
    hasClientContacts = contact !== undefined;
  }

  return resolveUserRole({
    userId: params.userId,
    producerRow: producerRow ?? null,
    hasClientContacts,
  });
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
export function decideRoleRedirect(
  role: UserRole,
  expected: ExpectedRole,
): string | null {
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

/**
 * I/O: enforces the role boundary at the top of a protected layout
 * or server action. Calls Clerk + the DB to resolve the user's role,
 * then redirects on mismatch. Returns the resolved userId on allow so
 * callers don't need to re-call auth() before their own data loading.
 */
export async function requireRole(
  expected: ExpectedRole,
): Promise<{ userId: string }> {
  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideRoleRedirect(role, expected);
  if (redirectTo) redirect(redirectTo);

  // Past the redirect → role is one of the allow-states, all of which
  // require a userId to have been resolved upstream.
  return { userId: userId as string };
}
