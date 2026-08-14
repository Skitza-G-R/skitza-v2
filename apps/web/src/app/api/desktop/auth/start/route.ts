import { and, createDb, eq, isNull, producers } from "@skitza/db";
import { NextResponse } from "next/server";

import { auth } from "~/server/auth/clerk-identity";
import {
  createDesktopSocialAuthStore,
  desktopAuthCallbackUrl,
  issueDesktopAuthorizationCode,
  parseDesktopAuthStartUrl,
} from "~/server/auth/desktop-social-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

function privateResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: PRIVATE_HEADERS });
}

function signInRedirect(url: URL): Response {
  const signIn = new URL("/sign-in", url.origin);
  signIn.searchParams.set("redirect_url", `${url.pathname}${url.search}`);
  return new NextResponse(null, {
    status: 303,
    headers: { ...PRIVATE_HEADERS, Location: signIn.toString() },
  });
}

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const handoff = parseDesktopAuthStartUrl(requestUrl);
  if (!handoff) return privateResponse("Bad request", 400);

  let userId: string | null;
  try {
    ({ userId } = await auth());
  } catch {
    return privateResponse("Desktop authentication is unavailable", 503);
  }
  if (!userId) return signInRedirect(requestUrl);

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return privateResponse("Desktop authentication is unavailable", 503);

  try {
    const db = createDb(dbUrl);
    const [producer] = await db
      .select({ id: producers.id })
      .from(producers)
      .where(and(eq(producers.clerkUserId, userId), isNull(producers.closedAt)))
      .limit(1);
    if (!producer) return privateResponse("Forbidden", 403);

    const code = await issueDesktopAuthorizationCode({
      codeChallenge: handoff.codeChallenge,
      producerId: producer.id,
      state: handoff.state,
      store: createDesktopSocialAuthStore(db),
    });
    return new NextResponse(null, {
      status: 303,
      headers: {
        ...PRIVATE_HEADERS,
        Location: desktopAuthCallbackUrl({ code, state: handoff.state }),
      },
    });
  } catch {
    return privateResponse("Desktop authentication is unavailable", 503);
  }
}
