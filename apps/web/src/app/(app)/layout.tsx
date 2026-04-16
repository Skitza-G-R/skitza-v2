import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { createDb, producers, eq } from "@skitza/db";
import { isAutoSlug } from "~/lib/slug";

// Gate: any authed (app) route requires a "complete" Producer profile.
// "Complete" = displayName not null AND slug isn't the email-derived
// default. Webhook seeds the row with auto-slug + null displayName at
// Clerk sign-up; /onboarding is the form that fills both in.
//
// /onboarding lives in its own (onboarding) route group so this layout
// doesn't apply to it (which would otherwise loop incomplete users
// indefinitely).
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in"); // belt-and-braces; middleware should have caught this

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const db = createDb(dbUrl);
  const [row] = await db
    .select({ displayName: producers.displayName, slug: producers.slug, email: producers.email })
    .from(producers)
    .where(eq(producers.clerkUserId, user.id))
    .limit(1);

  // Webhook is async — first dashboard hit may race the Producer insert.
  // Treat "no row yet" the same as "incomplete profile": send to
  // /onboarding, whose action's UPDATE will affect 0 rows until the
  // webhook lands, after which the next render passes the gate.
  if (!row) redirect("/onboarding");

  const incomplete = row.displayName === null || isAutoSlug(row.slug, row.email);
  if (incomplete) redirect("/onboarding");

  return <>{children}</>;
}
