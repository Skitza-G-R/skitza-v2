import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { createDb, producers, clientContacts, eq } from "@skitza/db";
import { AppI18nProvider } from "~/i18n/app-i18n-provider";
import { decideAppLayoutRedirect } from "./decide-redirect";

// Gate: any authed (app) route requires either a "complete" Producer
// profile (→ render dashboard) or an artist identity (→ /artist).
// The routing policy itself lives in ./decide-redirect.ts as a pure
// function so it can be unit-tested without Clerk/Drizzle/next mocks.
//
// "Complete" Producer = displayName not null AND slug isn't the
// email-derived default. Webhook seeds the row with auto-slug + null
// displayName at Clerk sign-up; /onboarding is the form that fills
// both in.
//
// /onboarding lives in its own (onboarding) route group so this layout
// doesn't apply to it (which would otherwise loop incomplete users
// indefinitely).
//
// 2026-04-22 — BUG FIX (docs/audit-report.md Task 15). Before this,
// any authed user without a producers row was unconditionally sent to
// /onboarding. Artists who self-serve via /join/<slug> now correctly
// have NO producers row (webhook branches on unsafe_metadata), so
// without this change they'd get funneled into producer onboarding.
// The extra client_contacts lookup below routes them to /artist.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in"); // belt-and-braces; middleware should have caught this

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const db = createDb(dbUrl);

  // Primary query: producer by clerkUserId. 99% of /dashboard hits
  // are established producers — this lookup is a single index hit.
  const [producerRow] = await db
    .select({
      displayName: producers.displayName,
      slug: producers.slug,
      email: producers.email,
    })
    .from(producers)
    .where(eq(producers.clerkUserId, user.id))
    .limit(1);

  // Secondary query: only fire if no producer row. For artists who
  // joined via /join/<slug>, we need to know they exist as a client
  // contact so we can route them to /artist instead of /onboarding.
  // Conditional so the hot path (established producer) stays one query.
  let hasClientContacts = false;
  if (!producerRow) {
    const [contact] = await db
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(eq(clientContacts.clerkUserId, user.id))
      .limit(1);
    hasClientContacts = contact !== undefined;
  }

  const redirectTo = decideAppLayoutRedirect({
    userId: user.id,
    producerRow: producerRow ?? null,
    hasClientContacts,
  });

  if (redirectTo) redirect(redirectTo);

  return <AppI18nProvider>{children}</AppI18nProvider>;
}
