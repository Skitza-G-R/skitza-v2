import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { createDb, producers, eq } from "@skitza/db";

// Post-signup router — Bug A fix.
//
// Clerk's dashboard "After sign-up fallback" is set to `/post-signup`.
// That dashboard setting overrides any component-level
// `fallbackRedirectUrl`, so the only reliable way to land users on a
// role-correct destination is to send everyone here first and decide
// once, in code, with full visibility into both unsafeMetadata and the
// DB.
//
// Resolution order:
//   1. No signed-in user (direct hit)               → /sign-in
//   2. unsafeMetadata says "join" + slug is valid + slug resolves to a
//      real producer in the DB                       → /artist-welcome/<slug>
//   3. anything else (no metadata, tampered slug,
//      stale slug, deleted producer)                 → /post-signin
//
// Why re-validate the slug against the DB even though it was already
// checked by the webhook: the webhook is async and may not have run
// yet (sub-second race). Trusting the metadata blindly here would let
// a tampered client land any signed-in user on /artist-welcome/anything.
// The DB check mirrors the webhook's defense-in-depth pattern.

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9-]+$/;

export default async function PostSignupPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const meta = user.unsafeMetadata as
    | { signupOrigin?: unknown; producerSlug?: unknown }
    | undefined;

  const isJoinOrigin = meta?.signupOrigin === "join";
  const rawSlug = meta?.producerSlug;
  const claimedSlug =
    isJoinOrigin && typeof rawSlug === "string" && SLUG_RE.test(rawSlug)
      ? rawSlug
      : null;

  if (!claimedSlug) {
    redirect("/post-signin");
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const db = createDb(dbUrl);
  const [producer] = await db
    .select({ id: producers.id })
    .from(producers)
    .where(eq(producers.slug, claimedSlug))
    .limit(1);

  if (!producer) {
    redirect("/post-signin");
  }

  Sentry.addBreadcrumb({
    category: "auth",
    message: "post-signup join-flow resolved",
    level: "info",
    data: {
      clerkUserId: user.id,
      producerSlug: claimedSlug,
    },
  });

  redirect(`/artist-welcome/${encodeURIComponent(claimedSlug)}`);
}
