import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createDb, eq, magicLinks, magicLinkViews, producers } from "@skitza/db";
import { MagicTokenInvalid, verifyMagicToken } from "~/lib/magic-links/token";

// We read request headers and write a `magic_link_views` row on every hit, so
// Next must execute this on each request — never statically optimize.
export const dynamic = "force-dynamic";

// All failure paths return the same opaque 404. Differentiating "expired" vs
// "revoked" vs "never existed" would let an attacker enumerate token-hash
// space (does this URL pattern correspond to a real-but-stale link?).
const notFound = (): NextResponse => new NextResponse(null, { status: 404 });

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function GET(req: Request, { params }: RouteContext): Promise<Response> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    // No DATABASE_URL is an operator misconfiguration, not a token problem.
    // Surface as 500 so it shows up in monitoring instead of being silently
    // 404'd alongside legitimate bad-token traffic.
    return new NextResponse(null, { status: 500 });
  }

  const { token } = await params;

  // 1. Verify the token signature/expiry/shape. `verifyMagicToken` throws
  //    `MagicTokenInvalid` for every failure mode — collapse to 404.
  try {
    verifyMagicToken(token);
  } catch (err) {
    if (err instanceof MagicTokenInvalid) return notFound();
    throw err;
  }

  // 2. Look up the magic_links row by hash and JOIN producers.slug in one
  //    round-trip. The hex-encoded SHA-256 must match the format Task G's
  //    `magicLink.issue` writes.
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const db = createDb(dbUrl);
  const [link] = await db
    .select({
      id: magicLinks.id,
      producerId: magicLinks.producerId,
      target: magicLinks.target,
      expiresAt: magicLinks.expiresAt,
      revokedAt: magicLinks.revokedAt,
      producerSlug: producers.slug,
    })
    .from(magicLinks)
    .innerJoin(producers, eq(producers.id, magicLinks.producerId))
    .where(eq(magicLinks.tokenHash, tokenHash))
    .limit(1);

  if (!link) return notFound();
  if (link.revokedAt !== null) return notFound();
  if (link.expiresAt.getTime() < Date.now()) return notFound();

  // 3. Resolve the redirect target before the view insert so a slow/failed
  //    insert can't change which URL we send the user to.
  let destination: string;
  switch (link.target) {
    case "portfolio":
      destination = `/p/${link.producerSlug}`;
      break;
    case "booking":
      // Public booking page is at /p/<slug>/book (Task K+ shipped long
      // ago). Historical note: an earlier version of this handler
      // redirected to /book/<slug> as a placeholder while the real
      // route was being built — that placeholder was never updated
      // when the real route shipped, silently 404'ing every booking-
      // target magic link ever issued until this fix.
      destination = `/p/${link.producerSlug}/book`;
      break;
    default:
      // future: project:<uuid> targets land here. Until they're implemented
      // we'd rather 404 than crash or redirect to a bogus URL.
      return notFound();
  }

  // 4. Capture the visit. Web `Request` exposes headers via `.get()` — using
  //    bracket-notation against `req.headers` would compile but always read
  //    `undefined` (Headers isn't a plain object).
  const xff = req.headers.get("x-forwarded-for");
  const viewValues = {
    magicLinkId: link.id,
    // x-forwarded-for is a comma-separated chain ("client, proxy1, proxy2");
    // the first entry is the originating client per RFC 7239 conventions.
    ip: xff ? (xff.split(",")[0]?.trim() ?? null) : null,
    userAgent: req.headers.get("user-agent"),
    referer: req.headers.get("referer"),
  };

  // The dwell-time beacon (Task H.5/I) updates the *view* row, not the link
  // row, so we propagate the inserted view id as `?via=` rather than the
  // link id. The plan's wording (`?via=<magicLinkId>`) is corrected here.
  let viewId: string | null = null;
  try {
    const [inserted] = await db
      .insert(magicLinkViews)
      .values(viewValues)
      .returning({ id: magicLinkViews.id });
    viewId = inserted?.id ?? null;
  } catch (err) {
    // Catching here is an explicit policy decision: analytics must never
    // break navigation. We log with the link id (NOT the raw token, which
    // would let an attacker reading logs replay the magic link) so an
    // operator can correlate dropped views back to a specific link.
    console.error(
      `[magic-link] failed to log view for link ${link.id}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // Build the final URL relative to the incoming request so the redirect
  // preserves protocol/host (avoids an open-redirect surface from any
  // env-derived base URL).
  const url = new URL(destination, req.url);
  if (viewId !== null) url.searchParams.set("via", viewId);

  // 302 (temporary) — semantically correct for a one-shot landing that
  // funnels into the producer's portfolio/booking flow.
  return NextResponse.redirect(url, 302);
}
